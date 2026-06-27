// Package natsx owns the core-api NATS JetStream connection and stream topology for the
// outbox→NATS relay (Core slice 3). It is named natsx — not nats — to avoid colliding
// with the upstream github.com/nats-io/nats.go package it wraps. The drain loop that
// publishes pending outbox rows lands in internal/relay (PR-3b); this package only
// establishes the connection and provisions the streams a publish targets.
//
// The connection is NON-fail-fast: nats.Connect retries in the background so a
// momentarily-down broker never blocks process start — readiness reports it (mirroring
// the lazy pgx pool, db.Open). Streams are provisioned, never consumers: the Rust GPU
// worker owns its durable consumer config (§4, ADR-007). NATS is never exposed to the
// browser (ADR-008).
package natsx

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
)

// Stream topology. event_type is the literal NATS subject (ADR-029), so order.* events
// land in ORDERS and asset_job.* in ASSET_JOBS with no lookup. ORDERS is a Limits stream
// (notification consumers, later); ASSET_JOBS is a WorkQueue the GPU worker pulls from.
const (
	streamOrders     = "ORDERS"
	streamAssetJobs  = "ASSET_JOBS"
	subjectsOrders   = "order.>"
	subjectsAssetJob = "asset_job.>"
)

// Conn wraps a NATS connection and its JetStream context. The relay (PR-3b) publishes
// through JS; the readiness probe calls Reachable.
type Conn struct {
	nc *nats.Conn
	// JS is the JetStream context the relay publishes through.
	JS jetstream.JetStream
}

// Connect dials NATS and builds a JetStream context. It does NOT fail when the broker is
// down: with RetryOnFailedConnect the returned *Conn reconnects in the background and
// Reachable reports the live state. Returns an error only on a malformed URL or JS init
// failure (programming errors, not transient outages).
func Connect(cfg config.Config) (*Conn, error) {
	nc, err := nats.Connect(cfg.NATSURL,
		nats.Name("core-api"),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("natsx: connect: %w", err)
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("natsx: jetstream: %w", err)
	}
	return &Conn{nc: nc, JS: js}, nil
}

// EnsureTopology idempotently provisions the two streams the relay publishes into, so a
// publish never hits a no-responders error. CreateOrUpdateStream converges an existing
// stream to this config, so it is safe on every boot (and re-runnable in tests). Streams
// only — the worker owns its durable consumer (ADR-007). Bounded by ctx.
func (c *Conn) EnsureTopology(ctx context.Context, dupWindow time.Duration) error {
	specs := []jetstream.StreamConfig{
		{
			Name:       streamOrders,
			Subjects:   []string{subjectsOrders},
			Retention:  jetstream.LimitsPolicy,
			Duplicates: dupWindow,
		},
		{
			Name:       streamAssetJobs,
			Subjects:   []string{subjectsAssetJob},
			Retention:  jetstream.WorkQueuePolicy,
			Duplicates: dupWindow,
		},
	}
	for _, s := range specs {
		if _, err := c.JS.CreateOrUpdateStream(ctx, s); err != nil {
			return fmt.Errorf("natsx: ensure stream %s: %w", s.Name, err)
		}
	}
	return nil
}

// Reachable reports whether the NATS connection is currently established. The readiness
// probe uses it; the client auto-reconnects in the background, so it flips back to true
// when the broker returns.
func (c *Conn) Reachable() bool {
	return c != nil && c.nc != nil && c.nc.IsConnected()
}

// PublishMsg publishes msg through JetStream and awaits the PubAck. The relay (PR-3b) calls
// it per pending outbox row; it lives here so the relay depends only on natsx (not on the
// upstream jetstream package directly) and so a fake can satisfy the relay's broker interface
// in Docker-free unit tests. Subject + Nats-Msg-Id are set by the caller via msg + opts.
func (c *Conn) PublishMsg(ctx context.Context, msg *nats.Msg, opts ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	return c.JS.PublishMsg(ctx, msg, opts...)
}

// ReEnsureOnReconnect registers a reconnect handler that re-provisions the streams whenever
// the broker reconnects, so a topology lost across a NATS restart converges WITHOUT a
// core-api restart. The substrate (Connect/EnsureTopology) provisions at boot only — this is
// the slice-3 (PR-3b) carry-over that keeps the relay's accept-downtime story whole (ADR-009).
// CreateOrUpdateStream is idempotent, so a redundant re-ensure when the streams already exist
// is a cheap no-op. The relay's drain loop ALSO treats a no-stream publish as transient and
// re-ensures inline, covering the down-at-boot-then-up case (which fires no reconnect). Call
// once at startup, before the first reconnect.
func (c *Conn) ReEnsureOnReconnect(dupWindow time.Duration, log *slog.Logger) {
	if c == nil || c.nc == nil {
		return
	}
	c.nc.SetReconnectHandler(func(*nats.Conn) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := c.EnsureTopology(ctx, dupWindow); err != nil {
			log.Warn("nats: topology re-ensure on reconnect failed", "err", err)
			return
		}
		log.Info("nats: topology re-ensured on reconnect")
	})
}

// Close flushes any pending publishes then closes the connection synchronously. Called in
// the main shutdown sequence AFTER the relay goroutine has joined (so nothing is still
// publishing) and BEFORE the pgx pool closes.
func (c *Conn) Close() {
	if c == nil || c.nc == nil {
		return
	}
	_ = c.nc.FlushTimeout(2 * time.Second)
	c.nc.Close()
}
