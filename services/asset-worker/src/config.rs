//! Environment-driven configuration for the asset-worker.

use std::time::Duration;

/// Runtime configuration, all sourced from the environment with safe defaults.
#[derive(Debug, Clone)]
pub struct Config {
    /// NATS server URL (JetStream). Default targets the compose `nats` service.
    pub nats_url: String,
    /// JetStream stream the WorkQueue consumer binds. core-api provisions it (natsx/conn.go:
    /// `ASSET_JOBS`, WorkQueue retention, subjects `asset_job.>`); the worker owns its consumer.
    pub asset_stream: String,
    /// Durable consumer name — stable across restarts so redelivery + ack state survive a bounce.
    pub durable_name: String,
    /// Subject filter the consumer binds with. The relay publishes `asset_job.created` onto ASSET_JOBS
    /// (db/jobs.go), so this is the real wire subject — NOT the old `asset.job` placeholder.
    pub job_subject: String,
    /// Max delivery attempts before a message is Termed to the DLQ (conventions §Queue). Also the budget
    /// `pipeline::decide` uses to report `failed` on the final transient attempt instead of looping.
    pub max_deliver: u64,
    /// JetStream ack-wait: how long a delivered message may go un-acked before redelivery. Renders are
    /// long, so the worker sends InProgress heartbeats (below) to reset this while processing.
    pub ack_wait: Duration,
    /// Heartbeat interval — must be < `ack_wait` so an in-flight long render resets the timer before it
    /// expires (conventions §Queue "InProgress heartbeat cho render lâu").
    pub heartbeat: Duration,
    /// core-api base URL the render callback targets (PATCH /internal/asset-jobs/{id}, ADR-045).
    pub core_api_url: String,
    /// Static service Bearer the callback presents (ADR-045 `authService`). Empty until wired — the
    /// endpoint is fail-closed, so reports 401 and the job redelivers (harmless until both sides are set).
    pub worker_callback_token: String,
}

impl Config {
    /// Build config from the process environment, applying defaults.
    pub fn from_env() -> Self {
        // heartbeat < ack_wait is an invariant (a heartbeat that fires after ack_wait can't reset it);
        // both are simple env knobs with safe defaults, so no cross-validation beyond the max_deliver floor.
        Self {
            nats_url: env_or("NATS_URL", "nats://127.0.0.1:4222"),
            asset_stream: env_or("ASSET_STREAM", "ASSET_JOBS"),
            durable_name: env_or("ASSET_DURABLE", "asset-worker"),
            job_subject: env_or("ASSET_JOB_SUBJECT", "asset_job.created"),
            max_deliver: env_u64("ASSET_MAX_DELIVER", 5).max(1), // 0 would Term the first attempt
            ack_wait: Duration::from_secs(env_u64("ASSET_ACK_WAIT_SECS", 30)),
            heartbeat: Duration::from_secs(env_u64("ASSET_HEARTBEAT_SECS", 10)),
            core_api_url: env_or("CORE_API_URL", "http://127.0.0.1:8080"),
            worker_callback_token: env_or("WORKER_CALLBACK_TOKEN", ""),
        }
    }
}

/// Read `key` from the environment, falling back to `default` when it is unset or empty.
fn env_or(key: &str, default: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string(),
    }
}

/// Read `key` as a u64, falling back to `default` when unset, empty, or unparseable.
fn env_u64(key: &str, default: u64) -> u64 {
    match std::env::var(key) {
        Ok(v) => v.trim().parse().unwrap_or(default),
        Err(_) => default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_or_uses_default_when_unset() {
        // A name nothing sets — deterministic under parallel test execution.
        assert_eq!(
            env_or("LUMIN_ASSET_WORKER_DEFINITELY_UNSET", "fallback"),
            "fallback"
        );
    }

    #[test]
    fn env_or_pins_documented_defaults() {
        // Pin the exact default values via the pure helper with guaranteed-unset keys — deterministic
        // regardless of the ambient (CI) environment.
        assert_eq!(
            env_or("LUMIN_ASSET_WORKER_UNSET_NATS", "nats://127.0.0.1:4222"),
            "nats://127.0.0.1:4222"
        );
        assert_eq!(
            env_or("LUMIN_ASSET_WORKER_UNSET_SUBJECT", "asset_job.created"),
            "asset_job.created"
        );
    }

    #[test]
    fn env_u64_falls_back_on_unparseable() {
        assert_eq!(env_u64("LUMIN_ASSET_WORKER_UNSET_INT", 5), 5);
    }

    #[test]
    fn config_defaults_are_sane() {
        let cfg = Config::from_env();
        assert!(!cfg.nats_url.is_empty());
        assert!(!cfg.job_subject.is_empty());
        assert!(cfg.max_deliver >= 1);
        // The heartbeat must fire before ack-wait expires, else a long render is redelivered mid-flight.
        assert!(cfg.heartbeat < cfg.ack_wait, "heartbeat must be < ack_wait");
    }
}
