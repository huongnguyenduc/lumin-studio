//! The AssetJob the worker consumes off the `ASSET_JOBS` WorkQueue.

use serde::Deserialize;

/// The two asset-job kinds the producer enqueues (core-api `asset_job_type`, db/jobs.go).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobType {
    ModelIngest,
    SpriteRender,
}

/// The `asset_job.created` payload — byte-for-byte the camelCase JSON the core-api relay forwards
/// (db/jobs.go `assetJobCreatedPayload`; the relay publishes it verbatim, ADR-006/ADR-045). The ids
/// stay `String`: the worker only echoes `asset_job_id` back in the callback path and never
/// manipulates them, so a uuid dep would be dead weight (ponytail).
// allow(dead_code): every field is the deserialized WIRE CONTRACT (serde populates all of them and the
// parse tests assert on them), but only `asset_job_id` is read back by THIS slice's spine (log +
// callback path). product_id/job_type/source_model_url/source_version are the input the real per-kind
// processor reads (dispatch by job_type, fetch source_model_url) — it lands in the next slice.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetJob {
    pub asset_job_id: String,
    pub product_id: String,
    pub job_type: JobType,
    pub source_model_url: String,
    pub source_version: String,
}

impl AssetJob {
    /// Parse one message body. A malformed payload is a *poison* message — retrying a body that can't
    /// be parsed never helps, so the caller Terms it to the DLQ rather than redelivering (worker.rs).
    pub fn parse(data: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The EXACT shape the Go relay forwards (camelCase keys, snake_case jobType) — pins the wire
    // contract against db/jobs.go `assetJobCreatedPayload`. A drift here means silent zero-consumption.
    const CREATED: &str = r#"{"assetJobId":"018f8b2c-0000-7000-8000-000000000001","productId":"018f8b2c-0000-7000-8000-000000000002","jobType":"model_ingest","sourceModelUrl":"https://s3.luminstudio.vn/lumin-assets/models/2026/07/15/abc.glb","sourceVersion":"cafebabecafebabe"}"#;

    #[test]
    fn parses_model_ingest_created_payload() {
        let j = AssetJob::parse(CREATED.as_bytes()).expect("parse the Go payload");
        assert_eq!(j.job_type, JobType::ModelIngest);
        assert_eq!(j.asset_job_id, "018f8b2c-0000-7000-8000-000000000001");
        assert_eq!(j.source_version, "cafebabecafebabe");
        assert!(j.source_model_url.ends_with(".glb"));
    }

    #[test]
    fn parses_sprite_render_jobtype() {
        let body = r#"{"assetJobId":"a","productId":"b","jobType":"sprite_render","sourceModelUrl":"u","sourceVersion":"v"}"#;
        assert_eq!(
            AssetJob::parse(body.as_bytes()).unwrap().job_type,
            JobType::SpriteRender
        );
    }

    #[test]
    fn rejects_unknown_jobtype_and_malformed() {
        // An unknown jobType (e.g. the forbidden "poster") and non-JSON are both poison → parse error.
        let bad_type = r#"{"assetJobId":"a","productId":"b","jobType":"poster","sourceModelUrl":"u","sourceVersion":"v"}"#;
        assert!(AssetJob::parse(bad_type.as_bytes()).is_err());
        assert!(AssetJob::parse(b"not json").is_err());
    }
}
