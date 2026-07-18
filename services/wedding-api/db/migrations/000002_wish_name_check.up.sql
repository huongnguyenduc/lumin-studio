-- 000002_wish_name_check.up.sql — DB backstop for the server-side name cap
-- (public.go maxWishNameLen). Existing rows all came through the API, which
-- never allowed >100 chars in practice; NOT VALID skips the scan anyway.
ALTER TABLE wishes ADD CONSTRAINT wishes_name_len CHECK (char_length(name) <= 100) NOT VALID;
ALTER TABLE wishes VALIDATE CONSTRAINT wishes_name_len;
