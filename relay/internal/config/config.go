// Package config loads the productive relay configuration from a TOML file.
//
// The shape mirrors the top-level sections expected by §1.2 onward:
// [relay], [ratelimit], [storage], [logging]. Defaults are applied for any
// missing field so a minimal config (or even an empty file) yields a runnable
// relay.
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// Config is the root configuration struct. Field names use TOML conventions
// (lowercase with underscores) via struct tags; Go field names stay idiomatic.
type Config struct {
	Relay     RelaySection     `toml:"relay"`
	RateLimit RateLimitSection `toml:"ratelimit"`
	Storage   StorageSection   `toml:"storage"`
	Logging   LoggingSection   `toml:"logging"`
}

// RelaySection covers the bind address and the NIP-11 relay information
// document fields. Pubkey is the relay operator's hex pubkey (used as the
// admin pubkey in NIP-86 management flows once enabled).
type RelaySection struct {
	Addr         string `toml:"addr"`
	Name         string `toml:"name"`
	Description  string `toml:"description"`
	Pubkey       string `toml:"pubkey"`
	ContactEmail string `toml:"contact_email"`
	SoftwareURL  string `toml:"software_url"`
	Version      string `toml:"version"`
}

// RateLimitSection holds per-pubkey limits enforced in §1.2.6. The fields are
// loaded eagerly so the rate-limit hook can be wired without a separate
// config pass.
type RateLimitSection struct {
	PerMinute int `toml:"per_minute"`
	PerHour   int `toml:"per_hour"`
	BurstSize int `toml:"burst_size"`
}

// StorageSection points at the on-disk event store. The directory must exist
// or be creatable by the relay process; the storage backend (lmdb/sqlite) is
// chosen in §1.2.3.
type StorageSection struct {
	Path string `toml:"path"`
}

// LoggingSection controls the slog handler. Level is one of
// debug|info|warn|error. Format is one of json|text.
type LoggingSection struct {
	Level  string `toml:"level"`
	Format string `toml:"format"`
}

// Default returns a Config populated with sane defaults. Loaders apply this
// first and then overlay any fields present in the user file, so partial
// configs work as expected.
func Default() Config {
	return Config{
		Relay: RelaySection{
			Addr:        ":7777",
			Name:        "nostrdome-relay",
			Description: "Nostrdome sovereign-platform relay",
			Version:     "0.1.0-dev",
		},
		RateLimit: RateLimitSection{
			PerMinute: 30,
			PerHour:   600,
			BurstSize: 5,
		},
		Storage: StorageSection{
			Path: "./data",
		},
		Logging: LoggingSection{
			Level:  "info",
			Format: "json",
		},
	}
}

// Load reads the file at path and merges it on top of Default(). A missing
// file is a hard error; an empty file is fine and yields the defaults
// verbatim. Parse errors are wrapped with the absolute path so the operator
// can locate them quickly.
func Load(path string) (Config, error) {
	cfg := Default()
	abs, absErr := filepath.Abs(path)
	if absErr != nil {
		abs = path
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("config: read %s: %w", abs, err)
	}
	if _, err := toml.Decode(string(data), &cfg); err != nil {
		return Config{}, fmt.Errorf("config: parse %s: %w", abs, err)
	}
	cfg.applyFallbacks()
	return cfg, nil
}

// applyFallbacks reapplies defaults for any field the operator left blank.
// toml.Decode happily writes zero values when keys are missing under a
// section, so we re-fill those after decode rather than guessing in the
// decoder.
func (c *Config) applyFallbacks() {
	d := Default()
	if c.Relay.Addr == "" {
		c.Relay.Addr = d.Relay.Addr
	}
	if c.Relay.Name == "" {
		c.Relay.Name = d.Relay.Name
	}
	if c.Relay.Description == "" {
		c.Relay.Description = d.Relay.Description
	}
	if c.Relay.Version == "" {
		c.Relay.Version = d.Relay.Version
	}
	if c.RateLimit.PerMinute == 0 {
		c.RateLimit.PerMinute = d.RateLimit.PerMinute
	}
	if c.RateLimit.PerHour == 0 {
		c.RateLimit.PerHour = d.RateLimit.PerHour
	}
	if c.RateLimit.BurstSize == 0 {
		c.RateLimit.BurstSize = d.RateLimit.BurstSize
	}
	if c.Storage.Path == "" {
		c.Storage.Path = d.Storage.Path
	}
	if c.Logging.Level == "" {
		c.Logging.Level = d.Logging.Level
	}
	if c.Logging.Format == "" {
		c.Logging.Format = d.Logging.Format
	}
}
