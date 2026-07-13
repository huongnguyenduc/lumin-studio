-- Reverse of 000023: drop the pet-tag axis + the products.product_type column/enum → back to no Pet
-- Tag (fully reversible). Order: child tables before parents, then the column before its enum type.
DROP TABLE IF EXISTS lost_events;
DROP TABLE IF EXISTS pet_profiles;
DROP TABLE IF EXISTS pet_tags;
ALTER TABLE products DROP COLUMN IF EXISTS product_type;
DROP TYPE IF EXISTS pet_species;
DROP TYPE IF EXISTS pet_tag_status;
DROP TYPE IF EXISTS product_type;
