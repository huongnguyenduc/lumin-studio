-- 000027 — products.sprite_sheet_url (ADR-049): the OUTPUT column a `sprite_render` asset job writes.
-- Its ONLY writer is the render callback (ReportAssetJobResult / SetProductSpriteSheetUrl), exactly like
-- model3d_url (000003) — UpdateProduct deliberately never touches it, so the product editor form can't
-- blank it. Holds the 360° sprite-sheet URL the storefront uses for the card-hover turntable and the
-- model-viewer's no-WebGL fallback (ADR-007). NOT NULL DEFAULT '' mirrors model3d_url: every existing
-- product back-fills to '' (no sprite yet), and a product is "born" with no sprite.
ALTER TABLE products ADD COLUMN sprite_sheet_url text NOT NULL DEFAULT '';
