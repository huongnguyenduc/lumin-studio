-- 000016_order_item_configurator.down.sql — drop the ADR-037 order-side capture columns.
ALTER TABLE order_items
  DROP COLUMN option_choices,
  DROP COLUMN part_colors;
