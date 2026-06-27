package natsx

import (
	"context"
	"testing"
	"time"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
)

// These tests run WITHOUT Docker — they assert the keystone non-fail-fast boot contract that
// the testcontainers tests (which only boot an UP broker) never exercise. They run on the
// dev home box (no Docker) AND in CI.

// Connect against a down broker must NOT error: the client retries in the background, so a
// momentarily-down NATS never blocks process start (ADR-009 accept-downtime — main.go fails
// fast only on a Connect error). Reachable() reports the not-yet-connected state.
func TestConnectDownBrokerNonFatal(t *testing.T) {
	c, err := Connect(config.Config{NATSURL: "nats://127.0.0.1:1"})
	if err != nil {
		t.Fatalf("Connect to a down broker returned err = %v, want nil (non-fail-fast)", err)
	}
	t.Cleanup(c.Close)
	if c.Reachable() {
		t.Fatal("Reachable() = true against a down broker, want false")
	}
}

// EnsureTopology against a down broker must return an error within its context — this is the
// boot path main.go logs at Warn and continues past (non-fatal).
func TestEnsureTopologyDownBrokerErrors(t *testing.T) {
	c, err := Connect(config.Config{NATSURL: "nats://127.0.0.1:1"})
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(c.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.EnsureTopology(ctx, 2*time.Minute); err == nil {
		t.Fatal("EnsureTopology against a down broker returned nil, want a non-nil error (boot Warn path)")
	}
}

// A malformed URL is the ONE fail-fast path (conn.go) — main.go exits on it. url.Parse is
// lenient, so use an invalid port, which nats.Connect rejects up front.
func TestConnectMalformedURL(t *testing.T) {
	if _, err := Connect(config.Config{NATSURL: "nats://localhost:notaport"}); err == nil {
		t.Fatal("Connect with a malformed URL returned nil err, want a non-nil error (fail-fast path)")
	}
}

// Close + Reachable must be nil-safe (the defensive guards in conn.go) — a never-constructed
// or zero-value Conn must not panic.
func TestNilConnSafe(t *testing.T) {
	var c *Conn
	c.Close() // must not panic
	if c.Reachable() {
		t.Fatal("nil Conn Reachable() = true, want false")
	}
	z := &Conn{} // nc == nil
	z.Close()    // must not panic
	if z.Reachable() {
		t.Fatal("zero Conn Reachable() = true, want false")
	}
}
