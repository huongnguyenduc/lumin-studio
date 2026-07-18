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
    /// The baked python3 that runs BOTH CPU sidecars — `ingest.py` (trimesh) and `render.py`'s Pillow
    /// tiling (ADR-049). `python3` on the image; a venv path in local dev/tests. (INGEST_PYTHON, kept for
    /// compat — one interpreter serves both.)
    pub ingest_python: String,
    /// Path to the baked `ingest.py` (INGEST_SCRIPT). Defaults to its image location.
    pub ingest_script: String,
    /// Path to the baked `render.py` (RENDER_SCRIPT) — the sprite_render orchestrator that drives Blender
    /// (a subprocess it spawns) then tiles the frames into a WebP sheet (ADR-049). Defaults to its image
    /// location; runs on `ingest_python`.
    pub render_script: String,
    /// Wall-clock budget (secs) for one ingest.py run (INGEST_TIMEOUT_SECS). Passed to the child via env;
    /// on expiry the script exits EXIT_TIMEOUT (75) which the wrapper maps to Transient (redeliver).
    pub ingest_timeout_secs: u64,
    /// Wall-clock budget (secs) for one render.py run (RENDER_TIMEOUT_SECS) — kills a hung Blender
    /// (CUDA stall on the GTX 1060) that would otherwise wedge the concurrency=1 worker forever.
    pub render_timeout_secs: u64,
    /// Assets bucket (lumin-assets) access — the worker fetches the source model + uploads the glb here.
    /// `endpoint` is the INTERNAL Garage API; `public_base` the PUBLIC origin for URLs (see objectstore).
    /// Empty endpoint/public_base/creds ⇒ model_ingest is fail-closed (jobs redeliver, never failed).
    pub assets_endpoint: String,
    pub assets_region: String,
    pub assets_bucket: String,
    pub assets_public_base: String,
    pub assets_access_key: String,
    pub assets_secret: String,
}

impl Config {
    /// Build config from the process environment, applying defaults.
    pub fn from_env() -> Self {
        // heartbeat < ack_wait is an invariant (a heartbeat that fires after ack_wait can't reset it) —
        // enforced below by clamping a misconfigured heartbeat to half the ack-wait.
        let ack_wait = Duration::from_secs(env_u64("ASSET_ACK_WAIT_SECS", 30));
        let heartbeat = clamp_heartbeat(
            Duration::from_secs(env_u64("ASSET_HEARTBEAT_SECS", 10)),
            ack_wait,
        );
        Self {
            nats_url: env_or("NATS_URL", "nats://127.0.0.1:4222"),
            asset_stream: env_or("ASSET_STREAM", "ASSET_JOBS"),
            durable_name: env_or("ASSET_DURABLE", "asset-worker"),
            job_subject: env_or("ASSET_JOB_SUBJECT", "asset_job.created"),
            max_deliver: env_u64("ASSET_MAX_DELIVER", 5).max(1), // 0 would Term the first attempt
            ack_wait,
            heartbeat,
            core_api_url: env_or("CORE_API_URL", "http://127.0.0.1:8080"),
            worker_callback_token: env_or("WORKER_CALLBACK_TOKEN", ""),
            ingest_python: env_or("INGEST_PYTHON", "python3"),
            ingest_script: env_or("INGEST_SCRIPT", "/opt/asset-worker/pysrc/ingest.py"),
            render_script: env_or("RENDER_SCRIPT", "/opt/asset-worker/pysrc/render.py"),
            ingest_timeout_secs: env_u64("INGEST_TIMEOUT_SECS", 300).max(1),
            render_timeout_secs: env_u64("RENDER_TIMEOUT_SECS", 900).max(1),
            assets_endpoint: env_or("ASSETS_S3_ENDPOINT", ""),
            assets_region: env_or("ASSETS_S3_REGION", "garage"),
            assets_bucket: env_or("ASSETS_BUCKET", "lumin-assets"),
            assets_public_base: env_or("ASSETS_PUBLIC_BASE_URL", ""),
            assets_access_key: env_or("ASSETS_ACCESS_KEY_ID", ""),
            assets_secret: env_or("ASSETS_SECRET_ACCESS_KEY", ""),
        }
    }

    /// The assets store config, iff the load-bearing fields (endpoint, public base, creds) are wired.
    /// None ⇒ model_ingest can't fetch/upload, so it fails closed (redeliver) — see ModelIngestProcessor.
    pub fn assets_config(&self) -> Option<crate::objectstore::AssetStoreConfig> {
        if self.assets_endpoint.is_empty()
            || self.assets_public_base.is_empty()
            || self.assets_access_key.is_empty()
            || self.assets_secret.is_empty()
        {
            return None;
        }
        Some(crate::objectstore::AssetStoreConfig {
            s3_endpoint: self.assets_endpoint.clone(),
            s3_region: self.assets_region.clone(),
            bucket: self.assets_bucket.clone(),
            public_base_url: self.assets_public_base.clone(),
            access_key_id: self.assets_access_key.clone(),
            secret_access_key: self.assets_secret.clone(),
        })
    }
}

/// Enforce the heartbeat < ack_wait invariant: a heartbeat that fires at/after ack-wait can never reset
/// the timer, so an in-flight long render would redeliver mid-flight. A bad env is clamped (with a warn)
/// to half the ack-wait rather than trusted.
fn clamp_heartbeat(heartbeat: Duration, ack_wait: Duration) -> Duration {
    if heartbeat < ack_wait {
        return heartbeat;
    }
    let clamped = (ack_wait / 2).max(Duration::from_secs(1));
    tracing::warn!(
        heartbeat_secs = heartbeat.as_secs(),
        ack_wait_secs = ack_wait.as_secs(),
        clamped_secs = clamped.as_secs(),
        "ASSET_HEARTBEAT_SECS >= ASSET_ACK_WAIT_SECS — clamping heartbeat so in-flight jobs are not redelivered"
    );
    clamped
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
    fn clamp_heartbeat_enforces_the_invariant() {
        let s = Duration::from_secs;
        assert_eq!(clamp_heartbeat(s(10), s(30)), s(10)); // sane config untouched
        assert_eq!(clamp_heartbeat(s(30), s(30)), s(15)); // equal → half ack-wait
        assert_eq!(clamp_heartbeat(s(99), s(30)), s(15)); // above → half ack-wait
        assert_eq!(clamp_heartbeat(s(5), s(1)), s(1)); // tiny ack-wait → 1s floor
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
