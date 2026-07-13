-- 000025_pet_tag_code_seq.up.sql — the Pet Tag display-code sequence (P3-t slice t-2, ADR-041).
-- spec.md §10 (PetTag.code `#LMN-T0231`) · mirrors 000010_order_code_seq.
--
-- A pet_tags.code (`#LMN-T0231`, `#LMN-T0232`, …) is minted from this dedicated sequence INSIDE the
-- encode transaction (NextPetTagCode → nextval), the same concurrency-safe pattern order codes use:
-- two staff encoding at the same moment each get a distinct number by construction, beating a
-- MAX(code)+1 scan (races) or a random suffix (collides). Gaps are fine — nextval is non-transactional,
-- so a rolled-back encode still burns its number; the code is a display handle, never a count.
-- START WITH 231 makes the first code `#LMN-T0231`, matching the design mock (Lumin Pet Tag - Hi-fi).
CREATE SEQUENCE pet_tag_code_seq START WITH 231;
