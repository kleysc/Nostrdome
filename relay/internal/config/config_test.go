package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nostrdome-platform/relay/internal/config"
)

func writeFile(t *testing.T, name, body string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatalf("write tmp config: %v", err)
	}
	return p
}

func TestLoad_ValidFullConfig(t *testing.T) {
	body := `
[relay]
addr = ":9999"
name = "test-relay"
description = "Test"
pubkey = "abc123"
contact_email = "ops@example.com"
software_url = "https://example.com/relay"
version = "1.2.3"

[ratelimit]
per_minute = 60
per_hour = 1200
burst_size = 10

[storage]
path = "/var/data/relay"

[logging]
level = "debug"
format = "text"
`
	cfg, err := config.Load(writeFile(t, "relay.toml", body))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Relay.Addr != ":9999" {
		t.Errorf("Addr: got %q, want :9999", cfg.Relay.Addr)
	}
	if cfg.Relay.Pubkey != "abc123" {
		t.Errorf("Pubkey: got %q, want abc123", cfg.Relay.Pubkey)
	}
	if cfg.RateLimit.PerMinute != 60 {
		t.Errorf("PerMinute: got %d, want 60", cfg.RateLimit.PerMinute)
	}
	if cfg.RateLimit.BurstSize != 10 {
		t.Errorf("BurstSize: got %d, want 10", cfg.RateLimit.BurstSize)
	}
	if cfg.Storage.Path != "/var/data/relay" {
		t.Errorf("Storage.Path: got %q", cfg.Storage.Path)
	}
	if cfg.Logging.Level != "debug" || cfg.Logging.Format != "text" {
		t.Errorf("Logging: got %+v", cfg.Logging)
	}
}

func TestLoad_DefaultsAppliedForMissingFields(t *testing.T) {
	// Only override one field; everything else must come from Default().
	body := `
[relay]
name = "partial"
`
	cfg, err := config.Load(writeFile(t, "relay.toml", body))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	def := config.Default()
	if cfg.Relay.Name != "partial" {
		t.Errorf("Name override lost: %q", cfg.Relay.Name)
	}
	if cfg.Relay.Addr != def.Relay.Addr {
		t.Errorf("Addr default lost: got %q, want %q", cfg.Relay.Addr, def.Relay.Addr)
	}
	if cfg.RateLimit.PerMinute != def.RateLimit.PerMinute {
		t.Errorf("PerMinute default lost: got %d", cfg.RateLimit.PerMinute)
	}
	if cfg.RateLimit.BurstSize != def.RateLimit.BurstSize {
		t.Errorf("BurstSize default lost: got %d", cfg.RateLimit.BurstSize)
	}
	if cfg.Storage.Path != def.Storage.Path {
		t.Errorf("Storage default lost: got %q", cfg.Storage.Path)
	}
	if cfg.Logging.Level != def.Logging.Level || cfg.Logging.Format != def.Logging.Format {
		t.Errorf("Logging default lost: %+v", cfg.Logging)
	}
}

func TestLoad_InvalidPathReturnsError(t *testing.T) {
	_, err := config.Load("/this/path/does/not/exist/relay.toml")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestDefault_ProducesRunnableConfig(t *testing.T) {
	d := config.Default()
	if d.Relay.Addr == "" || d.Logging.Level == "" || d.RateLimit.PerMinute == 0 {
		t.Fatalf("Default has zero-value fields: %+v", d)
	}
}
