-- 000008_wish_edit_token.up.sql — self-edit auth for guests (HANDOFF §2.8
-- follow-up): a random token issued once at creation, stored only hashed;
-- the browser keeps the plaintext in localStorage. NULL for wishes created
-- before this migration — those can't be self-edited (no way to prove
-- authorship retroactively).
ALTER TABLE wishes ADD COLUMN edit_token_hash BYTEA;
