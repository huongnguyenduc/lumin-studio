-- Owner-picked DEFAULT colour per scope (flat product, or per part) — replaces the implicit
-- "first available by name" convention everywhere a default paint is derived (storefront open
-- colour, sprite_render freeze, admin 3D previews). false everywhere on rollout: every reader
-- falls back to first-available, so behaviour is unchanged until the owner picks one.
ALTER TABLE colors ADD COLUMN is_default boolean NOT NULL DEFAULT false;
