-- 000003_catalog.up.sql — catalog axis (Core slice 2, PR-2c). spec.md §02.
--
-- Enums product_status / option_type / review_status come from 000001. `material` is
-- open-ended in spec ("PLA · PETG · recycled-PLA …") so it is TEXT + CHECK, not a native
-- enum (ADR-028). Money columns are int8 (bigint) VND NOT NULL CHECK(>=0) (ADR-019).
-- reviews.customer_id is a bare column here; its FK to customers is added forward-only in
-- 000004 (the identity axis lands next).

CREATE TABLE categories (
  id   uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE products (
  id           uuid           PRIMARY KEY,
  slug         text           NOT NULL UNIQUE,
  name         text           NOT NULL,
  description  text           NOT NULL DEFAULT '',          -- spec "richtext"; markdown stored as text
  category_id  uuid           NOT NULL REFERENCES categories (id),
  base_price   bigint         NOT NULL CHECK (base_price >= 0),
  dimensions   jsonb          NOT NULL,                     -- {w,d,h} in mm
  material     text           NOT NULL CHECK (material IN ('PLA', 'PETG', 'recycled-PLA')),
  model3d_url  text           NOT NULL DEFAULT '',
  images       jsonb          NOT NULL DEFAULT '[]',        -- shop images; images[0] is the card cover
  status       product_status NOT NULL DEFAULT 'draft',
  rating_avg   real,                                        -- null until the first review
  review_count integer        NOT NULL DEFAULT 0,
  created_at   timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE colors (
  id          uuid    PRIMARY KEY,
  product_id  uuid    NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name        text    NOT NULL,
  hex         text    NOT NULL,
  available   boolean NOT NULL DEFAULT true,
  price_delta bigint  NOT NULL DEFAULT 0 CHECK (price_delta >= 0)
);
CREATE INDEX colors_product_idx ON colors (product_id);

CREATE TABLE options (
  id          uuid        PRIMARY KEY,
  product_id  uuid        NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  label       text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  type        option_type NOT NULL,
  price_delta bigint      NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  max_chars   integer                                       -- null unless an engraving char limit applies
);
CREATE INDEX options_product_idx ON options (product_id);

CREATE TABLE reviews (
  id          uuid          PRIMARY KEY,
  product_id  uuid          NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  customer_id uuid,                                         -- FK -> customers added in 000004 (forward-only)
  rating      smallint      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text          NOT NULL DEFAULT '',            -- review body (spec §02 Review.text)
  images      jsonb         NOT NULL DEFAULT '[]',
  reply       jsonb,                                        -- shop reply, null until replied
  status      review_status NOT NULL DEFAULT 'published',
  created_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX reviews_product_idx ON reviews (product_id);
