package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	cfg := Load()
	if cfg.Addr != ":8080" {
		t.Fatalf("default Addr = %q, want :8080", cfg.Addr)
	}
	if cfg.ReadHeaderTimeout <= 0 {
		t.Fatalf("ReadHeaderTimeout must be positive, got %v", cfg.ReadHeaderTimeout)
	}
	if cfg.ShutdownTimeout <= 0 {
		t.Fatalf("ShutdownTimeout must be positive, got %v", cfg.ShutdownTimeout)
	}
}

func TestLoadHonoursPORT(t *testing.T) {
	t.Setenv("PORT", "9090")
	if got := Load().Addr; got != ":9090" {
		t.Fatalf("Addr with PORT=9090 = %q, want :9090", got)
	}
}

func TestLoadFallsBackOnEmptyPORT(t *testing.T) {
	t.Setenv("PORT", "")
	if got := Load().Addr; got != ":8080" {
		t.Fatalf("Addr with empty PORT = %q, want :8080", got)
	}
}
