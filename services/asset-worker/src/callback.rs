//! Reporting results to core-api via the render callback (PATCH /internal/asset-jobs/{id}, ADR-045).

use std::future::Future;

use anyhow::Context;
use serde::Serialize;

use crate::config::Config;

/// The callback body — the camelCase JSON core-api's `AssetJobResultInput` expects. `status` is the
/// worker-lifecycle subset (`processing`|`ready`|`failed`, never `queued`); `model3dUrl` (model_ingest),
/// `spriteSheetUrl` (sprite_render, ADR-049) and `lastError` are omitted when absent, matching the optional
/// openapi fields. A `ready` carries exactly ONE output URL — the one for its job kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultBody {
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model3d_url: Option<String>,
    /// f-4: the structured glb URL (named objects) — core-api's AssetJobResultInput.model3dStructuredUrl.
    /// Omitted when None (a sprite_render / a nameless source), matching the optional openapi field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model3d_structured_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sprite_sheet_url: Option<String>,
    /// f-2: the object names a model_ingest found (core-api's AssetJobResultInput.objectNames). Omitted when
    /// empty (a sprite_render, a nameless STL, or an older-shape ready), matching the optional openapi field.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub object_names: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// Reports one job's result to core-api. A trait so the worker loop is unit-testable with a fake that
/// records calls (no HTTP), mirroring the Go relay's broker/store seams. `+ Send` as in `Processor`.
pub trait Reporter {
    fn report(
        &self,
        job_id: &str,
        body: &ResultBody,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// The real reporter: PATCH {core_api_url}/internal/asset-jobs/{id} with the static service Bearer
/// (ADR-045 `authService`). A non-2xx is an error the caller treats as a transient report failure
/// (redeliver — the callback is idempotent, so a re-report of a `ready` job is a safe no-op).
pub struct HttpReporter {
    base_url: String,
    token: String,
    client: reqwest::Client,
}

impl HttpReporter {
    pub fn new(cfg: &Config) -> Self {
        Self {
            base_url: cfg.core_api_url.trim_end_matches('/').to_string(),
            token: cfg.worker_callback_token.clone(),
            client: reqwest::Client::new(),
        }
    }
}

impl Reporter for HttpReporter {
    async fn report(&self, job_id: &str, body: &ResultBody) -> anyhow::Result<()> {
        let url = format!("{}/internal/asset-jobs/{}", self.base_url, job_id);
        let resp = self
            .client
            .patch(&url)
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await
            .with_context(|| format!("POST callback {url}"))?;
        let status = resp.status();
        if !status.is_success() {
            anyhow::bail!("callback {url} returned {status}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The optional fields must be OMITTED when None (core-api reads absent == unset), and present
    // otherwise — pins the wire shape core-api's AssetJobResultInput accepts.
    #[test]
    fn ready_body_serializes_with_model_url_only() {
        let b = ResultBody {
            status: "ready",
            model3d_url: Some("https://s3/lumin-assets/x.glb".into()),
            model3d_structured_url: None,
            sprite_sheet_url: None,
            object_names: vec![],
            last_error: None,
        };
        let j = serde_json::to_string(&b).unwrap();
        assert_eq!(
            j,
            r#"{"status":"ready","model3dUrl":"https://s3/lumin-assets/x.glb"}"#
        );
    }

    // f-2: a model_ingest ready that carries object names serializes the objectNames key (the shape core-api's
    // AssetJobResultInput.objectNames reads); order is preserved. An empty list would be omitted (skip-if-empty).
    #[test]
    fn ready_body_serializes_object_names_when_present() {
        let b = ResultBody {
            status: "ready",
            model3d_url: Some("https://s3/lumin-assets/x.glb".into()),
            model3d_structured_url: None,
            sprite_sheet_url: None,
            object_names: vec!["shade".into(), "base".into()],
            last_error: None,
        };
        assert_eq!(
            serde_json::to_string(&b).unwrap(),
            r#"{"status":"ready","model3dUrl":"https://s3/lumin-assets/x.glb","objectNames":["shade","base"]}"#
        );
    }

    // f-4: a model_ingest ready carries model3dStructuredUrl alongside model3dUrl (both .glb, distinct keys) —
    // the shape core-api reads to write products.model3d_structured_url. Omitted when None (skip-if-none).
    #[test]
    fn ready_body_serializes_structured_url() {
        let b = ResultBody {
            status: "ready",
            model3d_url: Some("https://s3/lumin-assets/derivatives/v/model.glb".into()),
            model3d_structured_url: Some(
                "https://s3/lumin-assets/derivatives/v/model_structured.glb".into(),
            ),
            sprite_sheet_url: None,
            object_names: vec![],
            last_error: None,
        };
        assert_eq!(
            serde_json::to_string(&b).unwrap(),
            r#"{"status":"ready","model3dUrl":"https://s3/lumin-assets/derivatives/v/model.glb","model3dStructuredUrl":"https://s3/lumin-assets/derivatives/v/model_structured.glb"}"#
        );
    }

    // A sprite_render ready reports spriteSheetUrl (not model3dUrl) — the camelCase key core-api reads.
    #[test]
    fn ready_body_serializes_with_sprite_url_only() {
        let b = ResultBody {
            status: "ready",
            model3d_url: None,
            model3d_structured_url: None,
            sprite_sheet_url: Some("https://s3/lumin-assets/sprite.webp".into()),
            object_names: vec![],
            last_error: None,
        };
        assert_eq!(
            serde_json::to_string(&b).unwrap(),
            r#"{"status":"ready","spriteSheetUrl":"https://s3/lumin-assets/sprite.webp"}"#
        );
    }

    #[test]
    fn failed_body_serializes_with_last_error_only() {
        let b = ResultBody {
            status: "failed",
            model3d_url: None,
            model3d_structured_url: None,
            sprite_sheet_url: None,
            object_names: vec![],
            last_error: Some("bad model".into()),
        };
        assert_eq!(
            serde_json::to_string(&b).unwrap(),
            r#"{"status":"failed","lastError":"bad model"}"#
        );
    }
}
