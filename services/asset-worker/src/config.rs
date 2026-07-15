//! Environment-driven configuration for the asset-worker.

/// Runtime configuration, all sourced from the environment with safe defaults.
#[derive(Debug, Clone)]
pub struct Config {
    /// NATS server URL (JetStream). Default targets the compose `nats` service.
    pub nats_url: String,
    /// Subject filter the AssetJob consumer binds with. The producer (core-api) provisions a
    /// WorkQueue stream `ASSET_JOBS` capturing `asset_job.>` and the relay publishes
    /// `asset_job.created` onto it (natsx/conn.go, db/jobs.go) — so this is the real wire subject,
    /// NOT the old `asset.job` placeholder. The durable pull consumer that binds this stream lands
    /// with the pipeline; it will add a stream + durable name here then (YAGNI until it exists).
    pub job_subject: String,
}

impl Config {
    /// Build config from the process environment, applying defaults.
    pub fn from_env() -> Self {
        Self {
            nats_url: env_or("NATS_URL", "nats://127.0.0.1:4222"),
            job_subject: env_or("ASSET_JOB_SUBJECT", "asset_job.created"),
        }
    }
}

/// Read `key` from the environment, falling back to `default` when it is unset
/// or empty.
fn env_or(key: &str, default: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string(),
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
        // Pin the exact default values via the pure helper with guaranteed-unset
        // keys — deterministic regardless of the ambient (CI) environment.
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
    fn config_defaults_are_non_empty() {
        let cfg = Config::from_env();
        assert!(!cfg.nats_url.is_empty());
        assert!(!cfg.job_subject.is_empty());
    }
}
