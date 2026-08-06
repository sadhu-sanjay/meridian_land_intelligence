-- Fallback zoning_districts seed for local/demo use, when you don't want
-- to run the real sync-zoning.js against ArcGIS. Dissolves parcels.zoning
-- into coarse districts and assigns synthetic negative source_oid values
-- (real ArcGIS OBJECTIDs are positive) so this never collides with rows
-- sync-zoning.js has upserted.
--
-- Run: psql "$DATABASE_URL" -f db/build-zoning-districts.sql
-- Or:  npm run db:zones
--
-- In production, prefer `npm run db:sync-zoning` (db/sync-zoning.js) —
-- it pulls the county's actual zoning-district boundaries instead of
-- approximating them from parcel edges.

DELETE FROM zoning_districts WHERE source_oid < 0;

INSERT INTO zoning_districts (source_oid, zone_code, zone_desc, geom)
SELECT
  -row_number() OVER () AS source_oid,
  zoning AS zone_code,
  initcap(zoning) || ' (dissolved from parcels — demo data)' AS zone_desc,
  ST_Multi(ST_UnaryUnion(ST_Collect(geom))) AS geom
FROM parcels
WHERE zoning IS NOT NULL
GROUP BY zoning;
