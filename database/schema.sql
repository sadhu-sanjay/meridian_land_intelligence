CREATE SCHEMA "public";
CREATE TABLE "cities" (
	"id" serial PRIMARY KEY,
	"source_oid" integer NOT NULL CONSTRAINT "cities_source_oid_key" UNIQUE,
	"local_id" text,
	"city_name" text NOT NULL,
	"city_type" text,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_name" text,
	"taxpayer_name" text
);
CREATE TABLE "spatial_ref_sys" (
	"srid" integer PRIMARY KEY,
	"auth_name" varchar(256),
	"auth_srid" integer,
	"srtext" varchar(2048),
	"proj4text" varchar(2048),
	CONSTRAINT "spatial_ref_sys_srid_check" CHECK (((srid > 0) AND (srid <= 998999)))
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
CREATE INDEX "cities_geom_idx" ON "cities" USING gist ("geom");
CREATE UNIQUE INDEX "cities_pkey" ON "cities" ("id");
CREATE UNIQUE INDEX "cities_source_oid_key" ON "cities" ("source_oid");
CREATE UNIQUE INDEX "parcel_scores_pkey" ON "parcel_scores" ("parcel_id");
CREATE UNIQUE INDEX "parcels_geo_id_key" ON "parcels" ("geo_id");
CREATE INDEX "parcels_geom_idx" ON "parcels" USING gist ("geom");
CREATE INDEX "parcels_name_trgm_idx" ON "parcels" USING gin ("name");
CREATE INDEX "parcels_owner_name_trgm" ON "parcels" USING gin ("owner_name");
CREATE UNIQUE INDEX "parcels_pkey" ON "parcels" ("id");
CREATE INDEX "parcels_score_idx" ON "parcels" ("score");
CREATE INDEX "parcels_surface_point_idx" ON "parcels" USING gist ("surface_point");
CREATE INDEX "parcels_taxpayer_name_trgm" ON "parcels" USING gin ("taxpayer_name");
CREATE INDEX "parcels_zoning_idx" ON "parcels" ("zoning");
CREATE UNIQUE INDEX "spatial_ref_sys_pkey" ON "spatial_ref_sys" ("srid");
CREATE INDEX "subdivisions_geom_idx" ON "subdivisions" USING gist ("geom");
CREATE UNIQUE INDEX "subdivisions_pkey" ON "subdivisions" ("id");
CREATE UNIQUE INDEX "subdivisions_plat_number_key" ON "subdivisions" ("plat_number");
CREATE INDEX "zoning_districts_code_idx" ON "zoning_districts" ("zone_code");
CREATE INDEX "zoning_districts_geom_idx" ON "zoning_districts" USING gist ("geom");
CREATE UNIQUE INDEX "zoning_districts_pkey" ON "zoning_districts" ("id");
CREATE UNIQUE INDEX "zoning_districts_source_oid_key" ON "zoning_districts" ("source_oid");
ALTER TABLE "parcel_scores" ADD CONSTRAINT "parcel_scores_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE;
CREATE VIEW "geography_columns" TABLESPACE public AS (SELECT current_database() AS f_table_catalog, n.nspname AS f_table_schema, c.relname AS f_table_name, a.attname AS f_geography_column, postgis_typmod_dims(a.atttypmod) AS coord_dimension, postgis_typmod_srid(a.atttypmod) AS srid, postgis_typmod_type(a.atttypmod) AS type FROM pg_class c, pg_attribute a, pg_type t, pg_namespace n WHERE t.typname = 'geography'::name AND a.attisdropped = false AND a.atttypid = t.oid AND a.attrelid = c.oid AND c.relnamespace = n.oid AND (c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND NOT pg_is_other_temp_schema(c.relnamespace) AND has_table_privilege(c.oid, 'SELECT'::text));
CREATE VIEW "geometry_columns" TABLESPACE public AS (SELECT current_database()::character varying(256) AS f_table_catalog, n.nspname AS f_table_schema, c.relname AS f_table_name, a.attname AS f_geometry_column, COALESCE(postgis_typmod_dims(a.atttypmod), 2) AS coord_dimension, COALESCE(NULLIF(postgis_typmod_srid(a.atttypmod), 0), 0) AS srid, replace(replace(COALESCE(NULLIF(upper(postgis_typmod_type(a.atttypmod)), 'GEOMETRY'::text), 'GEOMETRY'::text), 'ZM'::text, ''::text), 'Z'::text, ''::text)::character varying(30) AS type FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped JOIN pg_namespace n ON c.relnamespace = n.oid JOIN pg_type t ON a.atttypid = t.oid WHERE (c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND NOT c.relname = 'raster_columns'::name AND t.typname = 'geometry'::name AND NOT pg_is_other_temp_schema(c.relnamespace) AND has_table_privilege(c.oid, 'SELECT'::text));