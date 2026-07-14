-- seed-catalog.sql — a small DEMO/smoke catalog so the deployed storefront has something to browse and
-- the order flow can be exercised end-to-end (browse → detail → pick colour/engraving → price quote →
-- order). NOT a migration and NOT real inventory: delete these rows before a real launch, or just build
-- the real catalog in Admin and never apply this.
--
-- Idempotent: fixed UUIDs + ON CONFLICT (id) DO NOTHING → re-running is a no-op. Money is int VND
-- (ADR-019). status='active' is set explicitly — the column default 'draft' would hide these from the
-- storefront. images stays '[]' (no photos uploaded yet); the card/detail DTO renders an empty gallery
-- fine. dimensions is {w,d,h} in mm (the shape the Product DTO unmarshals). The products_search GIN index
-- computes immutable_unaccent(name||' '||description) at insert — it exists from migration 000012, so run
-- this AFTER the migrate Job.
--
-- Reusable for local dev too:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/k8s/seed-catalog.sql

BEGIN;

INSERT INTO categories (id, slug, name, display_order) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'den-ngu',       'Đèn ngủ',       0),
  ('a0000000-0000-4000-8000-000000000002', 'den-trang-tri', 'Đèn trang trí', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products
  (id, slug, name, description, category_id, base_price, dimensions, material, images, status) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'den-ngu-hinh-meo', 'Đèn ngủ hình mèo',
   'Đèn ngủ in 3D hình mèo nhỏ, ánh sáng ấm dịu cho góc phòng của bạn.',
   'a0000000-0000-4000-8000-000000000001', 390000, '{"w":180,"d":180,"h":240}', 'PLA', '[]', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'den-de-ban-hinh-nam', 'Đèn để bàn hình nấm',
   'Đèn để bàn dáng nấm, in PETG bền màu, hợp góc bàn làm việc.',
   'a0000000-0000-4000-8000-000000000002', 450000, '{"w":150,"d":150,"h":300}', 'PETG', '[]', 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'den-treo-mat-trang', 'Đèn treo mặt trăng',
   'Đèn treo hình mặt trăng, in từ nhựa tái chế, ánh sáng nhẹ như trăng rằm.',
   'a0000000-0000-4000-8000-000000000002', 620000, '{"w":200,"d":200,"h":200}', 'recycled-PLA', '[]', 'active')
ON CONFLICT (id) DO NOTHING;

-- price_delta is int VND added on top of base_price (server sums it; ADR-019).
INSERT INTO colors (id, product_id, name, hex, price_delta) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Trắng ngà', '#F5F0E6', 0),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Vàng nắng', '#F2C14E', 0),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Xanh rêu',  '#6B8E6B', 20000),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'Cam đất',   '#D97A4E', 0),
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'Trắng ngà', '#F5F0E6', 0),
  ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000003', 'Trắng ngà', '#F5F0E6', 0),
  ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000003', 'Xám tro',   '#8A8A8A', 0)
ON CONFLICT (id) DO NOTHING;

-- A single 'text' engraving option per product (self-contained — no option_choices/parts needed).
INSERT INTO options (id, product_id, label, description, type, price_delta, max_chars) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Khắc tên', 'Khắc tên bạn muốn lên đế đèn', 'text', 30000, 12),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
   'Khắc tên', 'Khắc tên hoặc lời nhắn ngắn', 'text', 30000, 15)
ON CONFLICT (id) DO NOTHING;

COMMIT;
