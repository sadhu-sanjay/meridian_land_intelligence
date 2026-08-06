-- Parcel Viewer schema — mirrors the production schema (Whatcom County
-- sync pipeline: sync-parcels.js / sync-zoning.js), so this is safe to
-- run against a fresh database and end up with the same shape.
--
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS parcels (
  id             SERIAL PRIMARY KEY,
  geo_id         TEXT NOT NULL UNIQUE,
  name           TEXT,
  zoning         TEXT,
  zoning_desc    TEXT,
  acreage        NUMERIC,
  market_value   NUMERIC,
  score          INTEGER,
  geom           GEOMETRY(MultiPolygon, 4326) NOT NULL,
  -- Computed automatically from geom — never insert/update this directly.
  surface_point  GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_PointOnSurface(geom)) STORED,
  prop_id        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parcels_geom_idx ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS parcels_surface_point_idx ON parcels USING GIST (surface_point);
CREATE INDEX IF NOT EXISTS parcels_name_trgm_idx ON parcels USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS parcels_zoning_idx ON parcels (zoning);
CREATE INDEX IF NOT EXISTS parcels_score_idx ON parcels (score);

-- Granular scoring, one row per parcel, populated by a separate scoring
-- process. Nullable/absent until a parcel has actually been scored —
-- the app's detail route LEFT JOINs this and treats a missing row as
-- "not yet scored" rather than an error.
CREATE TABLE IF NOT EXISTS parcel_scores (
  parcel_id           INTEGER PRIMARY KEY REFERENCES parcels(id) ON DELETE CASCADE,
  buildability        SMALLINT,
  flood_risk          SMALLINT,
  road_access         SMALLINT,
  utility_proximity   SMALLINT,
  zoning_flexibility  SMALLINT,
  flags               TEXT[],
  notes               TEXT,
  monument_status     TEXT,
  scored_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dissolved/authoritative zoning-district polygons, served by
-- /api/tiles/zones/:z/:x/:y when zoomed out past individual parcels.
-- source_oid is the upstream ArcGIS OBJECTID — sync-zoning.js upserts
-- on it, so re-running a sync is idempotent.
CREATE TABLE IF NOT EXISTS zoning_districts (
  id          SERIAL PRIMARY KEY,
  source_oid  INTEGER NOT NULL UNIQUE,
  zone_code   TEXT,
  zone_desc   TEXT,
  acres       NUMERIC,
  geom        GEOMETRY(MultiPolygon, 4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zoning_districts_geom_idx ON zoning_districts USING GIST (geom);
CREATE INDEX IF NOT EXISTS zoning_districts_code_idx ON zoning_districts (zone_code);
