-- 000005_orders.down.sql — reverse of 000005_orders.up.sql.
-- Drop order_items first (it references orders), then orders. The enums (000001) and the
-- referenced customers/products/colors tables belong to earlier migrations and stay.
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
