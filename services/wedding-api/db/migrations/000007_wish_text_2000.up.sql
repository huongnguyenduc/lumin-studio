-- 000007_wish_text_2000.up.sql — nâng cap lời chúc 500 → 2000 ký tự
-- (public.go maxWishLen). Cap 500 khiến lời chúc dài bị textarea cắt im lặng
-- giữa từ (đã xảy ra trên wall live). Constraint gốc là inline CHECK của
-- CREATE TABLE (tên mặc định wishes_text_check) nên phải drop rồi tạo lại.
ALTER TABLE wishes DROP CONSTRAINT IF EXISTS wishes_text_check;
ALTER TABLE wishes ADD CONSTRAINT wishes_text_check
  CHECK (btrim(text) <> '' AND char_length(text) <= 2000);
