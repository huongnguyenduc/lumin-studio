//! The AssetJob the worker consumes off the `ASSET_JOBS` WorkQueue.

use std::collections::HashMap;

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
// parse tests assert on them). asset_job_id is echoed on the callback path; job_type/source_model_url/
// source_version drive dispatch + fetch in the processors; part_colors/camera_theta are read by
// sprite_render. product_id is carried for completeness/logging and may be unread — the allow keeps
// that from warning.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetJob {
    pub asset_job_id: String,
    pub product_id: String,
    pub job_type: JobType,
    pub source_model_url: String,
    pub source_version: String,
    /// f-5 (amends ADR-049): the {objectName → "#RRGGBB"} snapshot a sprite_render job paints each named
    /// part with. `default` so a model_ingest payload (no `partColors` key) and any pre-f-5 producer parse
    /// to an empty map — the wire contract only grows for a sprite that has per-part colours.
    #[serde(default)]
    pub part_colors: HashMap<String, String>,
    /// ADR-038 follow-up: the owner-saved live-viewer azimuth (degrees) a sprite_render job starts its
    /// frame-0 turntable angle from, so the sprite opens facing the same way as the aligned viewer.
    /// `None` for model_ingest and for a product with no saved view yet — the worker keeps its own
    /// default (frame-0 at azimuth 0).
    #[serde(default)]
    pub camera_theta: Option<f64>,
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
    const CREATED: &str = r#"{"assetJobId":"018f8b2c-0000-7000-8000-000000000001","productId":"018f8b2c-0000-7000-8000-000000000002","jobType":"model_ingest","sourceModelUrl":"https://assets.luminstudio.vn/models/2026/07/15/abc.glb","sourceVersion":"cafebabecafebabe"}"#;

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

    #[test]
    fn parses_sprite_render_with_part_colors() {
        // The f-5 shape: a sprite_render payload carries the frozen {objectName → hex} map (Vietnamese
        // object names, camelCase `partColors`). Pins it against db/jobs.go `assetJobCreatedPayload`.
        // r##…##: the hex colours contain `"#`, which would close a plain r#"…"# early.
        let body = r##"{"assetJobId":"a","productId":"b","jobType":"sprite_render","sourceModelUrl":"u","sourceVersion":"v","partColors":{"Chao đèn":"#E8B923","Đế":"#3A3A3A"}}"##;
        let j = AssetJob::parse(body.as_bytes()).expect("parse sprite payload with partColors");
        assert_eq!(j.job_type, JobType::SpriteRender);
        assert_eq!(j.part_colors.len(), 2);
        assert_eq!(
            j.part_colors.get("Chao đèn").map(String::as_str),
            Some("#E8B923")
        );
    }

    #[test]
    fn part_colors_defaults_empty_when_absent() {
        // A model_ingest payload has NO partColors key (Go `omitempty`) → serde default → empty map. This is
        // what keeps the wire contract backward-compatible; the older CREATED const must still parse.
        let j = AssetJob::parse(CREATED.as_bytes()).unwrap();
        assert!(j.part_colors.is_empty());
    }

    #[test]
    fn parses_sprite_render_with_camera_theta() {
        // ADR-038 follow-up: the owner-saved live-viewer azimuth (camelCase `cameraTheta`). Pins against
        // db/jobs.go `assetJobCreatedPayload`.
        let body = r#"{"assetJobId":"a","productId":"b","jobType":"sprite_render","sourceModelUrl":"u","sourceVersion":"v","cameraTheta":42.5}"#;
        let j = AssetJob::parse(body.as_bytes()).expect("parse sprite payload with cameraTheta");
        assert_eq!(j.camera_theta, Some(42.5));
    }

    #[test]
    fn camera_theta_defaults_none_when_absent() {
        // No saved view yet (or a model_ingest payload) has NO cameraTheta key → serde default → None, and
        // the older CREATED const must still parse (backward-compatible wire contract).
        let j = AssetJob::parse(CREATED.as_bytes()).unwrap();
        assert_eq!(j.camera_theta, None);
    }
}
