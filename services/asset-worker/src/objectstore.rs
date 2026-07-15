//! The worker's Garage/S3 access to lumin-assets: fetch the source model, upload the derivative glb.
//!
//! Two URLs, deliberately different (mirrors core-api's modelstore split): `s3_endpoint` is the INTERNAL
//! API the worker does GET/PUT against (e.g. http://garage:3900, in-cluster, plain http); `public_base_url`
//! is the PUBLIC origin (https://assets.luminstudio.vn — Garage website mode, bucket implied by host, so no
//! /lumin-assets segment) used only to parse the source key out of a
//! `source_model_url` and to form the output `model3d_url`. The output URL must sit under `public_base_url`
//! so core-api's `OwnsOutputURL` host-pin (ADR-045) accepts it.

use anyhow::{Context, Result};
use object_store::aws::{AmazonS3, AmazonS3Builder};
use object_store::{
    path::Path as ObjPath, Attribute, AttributeValue, Attributes, GetOptions, ObjectStore,
    PutOptions, PutPayload,
};

/// Config for the worker's S3 (Garage) access to lumin-assets.
pub struct AssetStoreConfig {
    pub s3_endpoint: String,
    pub s3_region: String,
    pub bucket: String,
    pub public_base_url: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

/// Clone is cheap — `AmazonS3` is Arc-backed internally, so the two processors (model_ingest, sprite_render)
/// share one store without a second client.
#[derive(Clone)]
pub struct AssetStore {
    s3: AmazonS3,
    public_base_url: String, // trimmed, no trailing slash
}

impl AssetStore {
    pub fn new(cfg: AssetStoreConfig) -> Result<Self> {
        let s3 = AmazonS3Builder::new()
            .with_endpoint(cfg.s3_endpoint.trim_end_matches('/'))
            .with_region(&cfg.s3_region)
            .with_bucket_name(&cfg.bucket)
            .with_access_key_id(&cfg.access_key_id)
            .with_secret_access_key(&cfg.secret_access_key)
            .with_allow_http(true) // internal endpoint is plain http (in-cluster, ADR-009)
            .with_virtual_hosted_style_request(false) // Garage speaks path-style
            .build()
            .context("build S3 client")?;
        Ok(Self {
            s3,
            public_base_url: cfg.public_base_url.trim_end_matches('/').to_string(),
        })
    }

    /// The bucket-relative key for a `source_model_url`, iff it is under this store's public base.
    pub fn key_from_public_url(&self, url: &str) -> Option<String> {
        key_from_public_url(&self.public_base_url, url)
    }

    /// The public `model3d_url` for a stored key — under `public_base_url`, so core-api host-pins it.
    pub fn output_url(&self, key: &str) -> String {
        format!("{}/{}", self.public_base_url, key)
    }

    /// GET an object's bytes by bucket-relative key.
    pub async fn get(&self, key: &str) -> Result<Vec<u8>> {
        let got = self
            .s3
            .get_opts(&ObjPath::from(key), GetOptions::default())
            .await
            .with_context(|| format!("S3 get {key}"))?;
        Ok(got
            .bytes()
            .await
            .with_context(|| format!("S3 read {key}"))?
            .to_vec())
    }

    /// PUT a glb with the model content-type (so it serves as a model once public reads land).
    pub async fn put_glb(&self, key: &str, data: Vec<u8>) -> Result<()> {
        self.put_typed(key, data, "model/gltf-binary").await
    }

    /// PUT a WebP sprite sheet (ADR-049) with the image content-type — the storefront serves it as an
    /// `<img>`/background for the card-hover turntable + the model-viewer no-WebGL fallback.
    pub async fn put_webp(&self, key: &str, data: Vec<u8>) -> Result<()> {
        self.put_typed(key, data, "image/webp").await
    }

    /// PUT `data` at `key` with an explicit Content-Type (the one attribute serving cares about). Shared by
    /// put_glb / put_webp — the only difference between a derivative model and a derivative sprite is its type.
    async fn put_typed(&self, key: &str, data: Vec<u8>, content_type: &str) -> Result<()> {
        let attrs = Attributes::from_iter([(
            Attribute::ContentType,
            AttributeValue::from(content_type.to_string()),
        )]);
        self.s3
            .put_opts(
                &ObjPath::from(key),
                PutPayload::from(data),
                PutOptions {
                    attributes: attrs,
                    ..Default::default()
                },
            )
            .await
            .with_context(|| format!("S3 put {key}"))?;
        Ok(())
    }
}

/// Pure key derivation: the bucket-relative key iff `url` is exactly under `public_base` (same host-pin
/// shape core-api applies). Rejects a foreign/malformed URL or one with a query/fragment.
fn key_from_public_url(public_base: &str, url: &str) -> Option<String> {
    let prefix = format!("{}/", public_base.trim_end_matches('/'));
    let key = url.trim().strip_prefix(&prefix)?;
    if key.is_empty() || key.contains('?') || key.contains('#') {
        return None;
    }
    Some(key.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "https://s3.luminstudio.vn/lumin-assets";

    #[test]
    fn key_from_url_strips_the_public_base() {
        assert_eq!(
            key_from_public_url(
                BASE,
                "https://s3.luminstudio.vn/lumin-assets/models/2026/07/15/abc.glb"
            ),
            Some("models/2026/07/15/abc.glb".to_string())
        );
    }

    #[test]
    fn key_from_url_rejects_foreign_and_malformed() {
        assert_eq!(
            key_from_public_url(BASE, "https://evil.test/lumin-assets/x.glb"),
            None
        );
        assert_eq!(
            key_from_public_url(BASE, "https://s3.luminstudio.vn/other-bucket/x.glb"),
            None
        );
        assert_eq!(
            key_from_public_url(BASE, "https://s3.luminstudio.vn/lumin-assets/x.glb?sig=1"),
            None
        );
        assert_eq!(key_from_public_url(BASE, BASE), None); // the base itself has no key
    }

    // The output URL must round-trip back to its key (core-api host-pins it, then would re-derive it).
    #[test]
    fn output_url_is_under_base_and_round_trips() {
        let store_base = BASE.to_string();
        let key = "derivatives/cafebabe/model.glb";
        let url = format!("{store_base}/{key}");
        assert_eq!(
            url,
            "https://s3.luminstudio.vn/lumin-assets/derivatives/cafebabe/model.glb"
        );
        assert_eq!(key_from_public_url(BASE, &url), Some(key.to_string()));
    }

    // Website-mode public base is host-only — Garage serves lumin-assets by Host on its web endpoint, so the
    // URL has NO /lumin-assets path segment (infra/k8s/README §public asset serving). output_url must still
    // round-trip through key_from_public_url, and a foreign host must still be rejected.
    #[test]
    fn website_mode_host_only_base_round_trips() {
        const WEB: &str = "https://assets.luminstudio.vn";
        let key = "derivatives/cafebabe/model.glb";
        let url = format!("{WEB}/{key}");
        assert_eq!(
            url,
            "https://assets.luminstudio.vn/derivatives/cafebabe/model.glb"
        );
        assert_eq!(key_from_public_url(WEB, &url), Some(key.to_string()));
        assert_eq!(
            key_from_public_url(WEB, "https://evil.test/derivatives/x.glb"),
            None
        );
    }
}
