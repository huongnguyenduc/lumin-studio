ALTER TABLE wishes DROP CONSTRAINT IF EXISTS wishes_text_check;
ALTER TABLE wishes ADD CONSTRAINT wishes_text_check
  CHECK (btrim(text) <> '' AND char_length(text) <= 500);
