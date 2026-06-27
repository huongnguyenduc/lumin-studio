package natsx

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
)

// skipWithoutDocker skips the test when no healthy Docker provider is available. It wraps
// testcontainers.SkipIfProviderIsNotHealthy in a recover because that helper PANICS (not
// t.Skip) when there is no Docker daemon — exactly the local-dev case (the home box has no
// Docker). CI (ubuntu-latest) has Docker, so these run for real (ADR-020). Mirrors the
// internal/db helper of the same name.
func skipWithoutDocker(t *testing.T) {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Skipf("no healthy Docker provider, skipping integration test: %v", r)
		}
	}()
	testcontainers.SkipIfProviderIsNotHealthy(t)
}

// startNATS boots a throwaway NATS server with JetStream enabled and returns a connected
// *Conn. It skips cleanly without a Docker provider; CI runs it for real.
func startNATS(t *testing.T) *Conn {
	t.Helper()
	skipWithoutDocker(t)
	ctx := context.Background()
	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "nats:2.10-alpine",
			Cmd:          []string{"-js"},
			ExposedPorts: []string{"4222/tcp"},
			WaitingFor:   wait.ForLog("Server is ready").WithStartupTimeout(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("start nats container: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })

	host, err := ctr.Host(ctx)
	if err != nil {
		t.Fatalf("container host: %v", err)
	}
	port, err := ctr.MappedPort(ctx, "4222")
	if err != nil {
		t.Fatalf("mapped port: %v", err)
	}
	cfg := config.Config{NATSURL: fmt.Sprintf("nats://%s:%s", host, port.Port())}

	nc, err := Connect(cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(nc.Close)

	// Connect returns before the background dialer finishes (RetryOnFailedConnect); the
	// broker is up, so wait briefly for the connection to establish.
	deadline := time.Now().Add(5 * time.Second)
	for !nc.Reachable() && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if !nc.Reachable() {
		t.Fatal("never reached a connected state against an up broker")
	}
	return nc
}

// TestEnsureTopologyIdempotent provisions the streams, runs EnsureTopology a second time
// (must converge, no error), and asserts both streams exist with the expected subjects and
// retention. CreateOrUpdateStream is the idempotency guarantee the boot path relies on.
func TestEnsureTopologyIdempotent(t *testing.T) {
	nc := startNATS(t)
	ctx := context.Background()
	const dup1 = 1 * time.Minute
	const dup2 = 2 * time.Minute

	// The first run provisions the streams; the second run with a DIFFERENT dup window must
	// CONVERGE the existing streams (CreateOrUpdateStream updating a mutable field), not just
	// no-op — that convergence is the contract the boot path relies on when a deploy changes
	// RELAY_DUP_WINDOW.
	if err := nc.EnsureTopology(ctx, dup1); err != nil {
		t.Fatalf("EnsureTopology (provision): %v", err)
	}
	if err := nc.EnsureTopology(ctx, dup2); err != nil {
		t.Fatalf("EnsureTopology (converge): %v", err)
	}

	cases := []struct {
		stream    string
		subject   string
		retention jetstream.RetentionPolicy
	}{
		{streamOrders, subjectsOrders, jetstream.LimitsPolicy},
		{streamAssetJobs, subjectsAssetJob, jetstream.WorkQueuePolicy},
	}
	for _, c := range cases {
		s, err := nc.JS.Stream(ctx, c.stream)
		if err != nil {
			t.Fatalf("stream %s not found: %v", c.stream, err)
		}
		info, err := s.Info(ctx)
		if err != nil {
			t.Fatalf("stream %s info: %v", c.stream, err)
		}
		if len(info.Config.Subjects) != 1 || info.Config.Subjects[0] != c.subject {
			t.Fatalf("stream %s subjects = %v, want [%s]", c.stream, info.Config.Subjects, c.subject)
		}
		if info.Config.Retention != c.retention {
			t.Fatalf("stream %s retention = %v, want %v", c.stream, info.Config.Retention, c.retention)
		}
		if info.Config.Duplicates != dup2 {
			t.Fatalf("stream %s dup window = %v, want %v (converged from %v)", c.stream, info.Config.Duplicates, dup2, dup1)
		}
	}
}

// TestPublishLandsInStream proves the topology actually captures the literal event_type
// subject (ADR-029) — a publish to order.created gets a PubAck naming the ORDERS stream,
// so the relay (PR-3b) will never hit a no-responders error.
func TestPublishLandsInStream(t *testing.T) {
	nc := startNATS(t)
	ctx := context.Background()
	if err := nc.EnsureTopology(ctx, 2*time.Minute); err != nil {
		t.Fatalf("EnsureTopology: %v", err)
	}

	ack, err := nc.JS.Publish(ctx, "order.created", []byte(`{"total":390000}`))
	if err != nil {
		t.Fatalf("publish order.created: %v", err)
	}
	if ack.Stream != streamOrders {
		t.Fatalf("PubAck stream = %q, want %q", ack.Stream, streamOrders)
	}

	jobAck, err := nc.JS.Publish(ctx, "asset_job.created", []byte(`{"jobType":"sprite_render"}`))
	if err != nil {
		t.Fatalf("publish asset_job.created: %v", err)
	}
	if jobAck.Stream != streamAssetJobs {
		t.Fatalf("PubAck stream = %q, want %q", jobAck.Stream, streamAssetJobs)
	}
}
