CREATE SCHEMA "public";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE "parcel_scores" (
	"parcel_id" integer PRIMARY KEY,
	"buildability" smallint,
	"flood_risk" smallint,
	"road_access" smallint,
	"utility_proximity" smallint,
	"zoning_flexibility" smallint,
	"flags" text[],
	"notes" text,
	"monument_status" text,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "parcels" (
	"id" serial PRIMARY KEY,
	"geo_id" text NOT NULL CONSTRAINT "parcels_geo_id_key" UNIQUE,
	"name" text,
	"zoning" text,
	"zoning_desc" text,
	"acreage" numeric,
	"market_value" numeric,
	"score" integer,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"surface_point" geometry(point,4326) GENERATED ALWAYS AS (st_pointonsurface(geom)) STORED,
	"prop_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "subdivisions" (
	"id" serial PRIMARY KEY,
	"name" text,
	"subdivision_name" text,
	"plat_number" text CONSTRAINT "subdivisions_plat_number_key" UNIQUE,
	"acreage" numeric(12, 2),
	"geom" geometry(MultiPolygon,4326) NOT NULL
);
CREATE TABLE "zoning_districts" (
	"id" serial PRIMARY KEY,
	"source_oid" integer NOT NULL CONSTRAINT "zoning_districts_source_oid_key" UNIQUE,
	"zone_code" text,
	"zone_desc" text,
	"acres" numeric,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "parcel_scores_pkey" ON "parcel_scores" ("parcel_id");
CREATE UNIQUE INDEX "parcels_geo_id_key" ON "parcels" ("geo_id");
CREATE INDEX "parcels_geom_idx" ON "parcels" USING gist ("geom");
CREATE INDEX "parcels_name_trgm_idx" ON "parcels" USING gin ("name" gin_trgm_ops);
CREATE UNIQUE INDEX "parcels_pkey" ON "parcels" ("id");
CREATE INDEX "parcels_score_idx" ON "parcels" ("score");
CREATE INDEX "parcels_surface_point_idx" ON "parcels" USING gist ("surface_point");
CREATE INDEX "parcels_zoning_idx" ON "parcels" ("zoning");
CREATE INDEX "subdivisions_geom_idx" ON "subdivisions" USING gist ("geom");
CREATE UNIQUE INDEX "subdivisions_pkey" ON "subdivisions" ("id");
CREATE UNIQUE INDEX "subdivisions_plat_number_key" ON "subdivisions" ("plat_number");
CREATE INDEX "zoning_districts_code_idx" ON "zoning_districts" ("zone_code");
CREATE INDEX "zoning_districts_geom_idx" ON "zoning_districts" USING gist ("geom");
CREATE UNIQUE INDEX "zoning_districts_pkey" ON "zoning_districts" ("id");
CREATE UNIQUE INDEX "zoning_districts_source_oid_key" ON "zoning_districts" ("source_oid");
ALTER TABLE "parcel_scores" ADD CONSTRAINT "parcel_scores_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE;
