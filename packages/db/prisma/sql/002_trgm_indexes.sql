-- NOTE: these four are now ALSO declared in schema.prisma as
--   @@index([col(ops: raw("gin_trgm_ops"))], type: Gin, map: "<same name>")
-- and that declaration is what keeps them alive: Prisma diffs the database
-- against schema.prisma, and an index it cannot see is one it writes a
-- DROP INDEX for on the next `migrate dev`.
--
-- This file is the copy inlined into the init migration. Do not add new
-- trigram indexes here — declare them in schema.prisma and let Migrate emit
-- the DDL. Raw SQL is only for what Prisma cannot express, which is why
-- 003's partial indexes stay in raw SQL (the diff ignores WHERE clauses).

-- Fuzzy admin search. Trigram GIN beats ILIKE '%x%' the moment the table grows.
CREATE INDEX IF NOT EXISTS products_title_trgm_idx
  ON products USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS product_variants_sku_trgm_idx
  ON product_variants USING GIN (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS brands_name_trgm_idx
  ON brands USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING GIN (email gin_trgm_ops);
