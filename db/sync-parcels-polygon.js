/**
 * sync-parcels.js
 *
 * Pulls parcel polygons + attributes from Whatcom County's ArcGIS
 * WhatcomCo_Property/MapServer/1 ("Public Tax Parcels") layer and
 * upserts them into `parcels`, keyed on `geo_id`.
 *
 * Unlike a point+radius sync, this pulls every parcel that
 * INTERSECTS the polygon defined by AREA_POINTS below — ArcGIS does
 * the spatial filtering server-side (geometry + spatialRel params),
 * so this never fetches more than that area.
 *
 *   - missing/blank geo_id           -> record skipped, reported at the end
 *   - missing/degenerate geometry    -> record skipped (ST_BuildArea guard)
 *   - non-numeric acreage/market_value -> stored as NULL, not a failure
 *   - any unexpected per-record error  -> caught, that record skipped,
 *                                         rest of the page still processes
 *   - duplicate geo_id within a page   -> last occurrence wins (Whatcom
 *                                         data has multi-segment parcels
 *                                         that share a geo_id)
 */

require("dotenv").config();
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — check your .env file.");
  process.exit(1);
}

// ---- Edit these points to change the area this pulls from ----
// Given as [lat, lng] (the order you'd naturally read coordinates in).
// This does NOT need to be a rectangle — any simple polygon works, in
// order around the boundary. It's closed automatically below if you
// don't repeat the first point at the end.
const AREA_POINTS = [
	[48.78361645149258, -122.51135959758078],
	[48.79376526447261, -122.43664965534646],
	[48.74452435633179, -122.44542999906729],
	[48.74127377350381, -122.51012726863102],
];
// ------------------------------------------------------------------

// ArcGIS wants rings as [lng, lat] pairs, closed (first point repeated
// at the end).
function buildRing(points) {
  const ring = points.map(([lat, lng]) => [lng, lat]);
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }
  return ring;
}

const AREA_RING = buildRing(AREA_POINTS);

// Confirmed against a real record via inspect-parcel-fields.js.
// Note: there is no single "site address" field on this layer — it's
// split across situsNum/situsStreetPrefix/situsStreet/situsCity, which
// buildSitusAddress() below joins into the `name` column.
const FIELD_MAP = {
  objectId: "OBJECTID",
  geoId: "geo_id",
  propId: "prop_id",
  zoning: "zoning",
  zoningDesc: "zoning_description",
  acreage: "legal_acreage",
  marketValue: "market",
  situsNum: "situs_num",
  situsStreetPrefix: "situs_street_prefix",
  situsStreet: "situs_street",
  situsCity: "situs_city",
};

const BASE_URL =
  "https://gis.whatcomcounty.us/arcgis/rest/services/EnterprisePublishing/WhatcomCo_Property/MapServer/1";
const PAGE_SIZE = 1000;
const MAX_RETRIES = 3;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: Object.values(FIELD_MAP).join(","),
    outSR: "4326",
    f: "json",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    // Spatial filter: only parcels that intersect AREA_RING.
    geometry: JSON.stringify({
      rings: [AREA_RING],
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryPolygon",
    spatialRel: "esriSpatialRelEnvelopeIntersects",
    inSR: "4326",
  });
  const url = `${BASE_URL}/query?${params.toString()}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(JSON.stringify(data.error));
      return data;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`  fetch attempt ${attempt} failed (${err.message}), retrying...`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Esri polygon geometry -> flat array of rings (each ring: [[x,y],[x,y],...])
function ringsOf(feature) {
  return feature.geometry?.rings ?? [];
}

// Coerces a raw attribute value to a finite number, or null. Never
// throws — a garbage value (empty string, "N/A", weird unit suffix)
// just becomes null instead of failing the whole batch insert.
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Coerces a raw attribute to a non-empty trimmed string, or null.
function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

// Joins the situs (site address) fields into one display string, e.g.
// "3109 LUMMI SHORE RD, BELLINGHAM". Any missing piece is just
// dropped rather than leaving stray whitespace/commas.
function buildSitusAddress(attrs) {
  const num = toStringOrNull(attrs[FIELD_MAP.situsNum]);
  const prefix = toStringOrNull(attrs[FIELD_MAP.situsStreetPrefix]);
  const street = toStringOrNull(attrs[FIELD_MAP.situsStreet]);
  const city = toStringOrNull(attrs[FIELD_MAP.situsCity]);

  const streetLine = [num, prefix, street].filter(Boolean).join(" ");
  return [streetLine, city].filter(Boolean).join(", ") || null;
}

async function upsertPage(client, features) {
  const rejected = [];
  // Keyed by geo_id so a duplicate geo_id within the same page overwrites
  // the earlier row instead of both landing in the same INSERT statement —
  // Postgres can't ON CONFLICT DO UPDATE the same row twice in one command.
  const byGeoId = new Map();
  let duplicateCount = 0;

  for (const f of features) {
    const attrs = f.attributes ?? {};
    const objectId = attrs[FIELD_MAP.objectId];

    try {
      const geoId = toStringOrNull(attrs[FIELD_MAP.geoId]);
      if (!geoId) {
        rejected.push({ objectId, reason: "missing geo_id" });
        continue;
      }

      const rings = ringsOf(f);
      if (!rings.length) {
        rejected.push({ objectId, geoId, reason: "missing geometry" });
        continue;
      }

      // Build a MULTILINESTRING WKT from the raw rings — ST_BuildArea
      // figures out shells vs. holes server-side.
      const lines = rings
        .map((ring) => `(${ring.map(([x, y]) => `${x} ${y}`).join(",")})`)
        .join(",");

      if (byGeoId.has(geoId)) duplicateCount++;

      byGeoId.set(geoId, {
        name: buildSitusAddress(attrs),
        zoning: toStringOrNull(attrs[FIELD_MAP.zoning]),
        zoningDesc: toStringOrNull(attrs[FIELD_MAP.zoningDesc]),
        acreage: toNumberOrNull(attrs[FIELD_MAP.acreage]),
        marketValue: toNumberOrNull(attrs[FIELD_MAP.marketValue]),
        propId: toStringOrNull(attrs[FIELD_MAP.propId]),
        wkt: `MULTILINESTRING(${lines})`,
      });
    } catch (err) {
      // Any unexpected shape (malformed rings, etc.) skips just this
      // record instead of aborting the page.
      rejected.push({ objectId, reason: `unexpected error: ${err.message}` });
    }
  }

  if (duplicateCount > 0) {
    console.warn(`  ${duplicateCount} duplicate geo_id(s) in this page — kept the last occurrence of each`);
  }

  const geoIds = [];
  const names = [];
  const zonings = [];
  const zoningDescs = [];
  const acreages = [];
  const marketValues = [];
  const propIds = [];
  const wkts = [];

  for (const [geoId, row] of byGeoId) {
    geoIds.push(geoId);
    names.push(row.name);
    zonings.push(row.zoning);
    zoningDescs.push(row.zoningDesc);
    acreages.push(row.acreage);
    marketValues.push(row.marketValue);
    propIds.push(row.propId);
    wkts.push(row.wkt);
  }

  if (geoIds.length === 0) return { upserted: 0, rejected };

  const result = await client.query(
    `
    WITH built AS (
      SELECT
        geo_id,
        name,
        zoning,
        zoning_desc,
        acreage,
        market_value,
        prop_id,
        ST_Multi(ST_BuildArea(ST_SetSRID(wkt::geometry, 4326))) AS geom
      FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[],
        $5::numeric[], $6::numeric[], $7::text[], $8::text[]
      ) AS t(geo_id, name, zoning, zoning_desc, acreage, market_value, prop_id, wkt)
    )
    INSERT INTO parcels (geo_id, name, zoning, zoning_desc, acreage, market_value, prop_id, geom)
    SELECT geo_id, name, zoning, zoning_desc, acreage, market_value, prop_id, geom
    FROM built
    WHERE geom IS NOT NULL AND ST_IsValid(geom)
    ON CONFLICT (geo_id) DO UPDATE SET
      name = EXCLUDED.name,
      zoning = EXCLUDED.zoning,
      zoning_desc = EXCLUDED.zoning_desc,
      acreage = EXCLUDED.acreage,
      market_value = EXCLUDED.market_value,
      prop_id = EXCLUDED.prop_id,
      geom = EXCLUDED.geom,
      updated_at = now()
    RETURNING geo_id
    `,
    [geoIds, names, zonings, zoningDescs, acreages, marketValues, propIds, wkts]
  );

  const upserted = result.rows.length;
  const succeeded = new Set(result.rows.map((r) => r.geo_id));
  for (const geoId of geoIds) {
    if (!succeeded.has(geoId)) {
      rejected.push({ geoId, reason: "invalid geometry (failed ST_IsValid after ST_BuildArea)" });
    }
  }

  return { upserted, rejected };
}

async function main() {
  const client = await pool.connect();
  let offset = Number(process.argv[2]) || 0;
  let totalUpserted = 0;
  const allRejected = [];

  try {
    console.log(
      `Syncing parcels inside the ${AREA_POINTS.length}-point area (starting at offset ${offset})...`
    );
    while (true) {
      let page;
      try {
        page = await fetchPage(offset);
      } catch (err) {
        console.error(
          `\nFailed to fetch page at offset ${offset} after ${MAX_RETRIES} attempts: ${err.message}`
        );
        console.error(`Resume later with: node sync-parcels.js ${offset}`);
        break;
      }

      const features = page.features || [];
      if (features.length === 0) break;

      const { upserted, rejected } = await upsertPage(client, features);
      totalUpserted += upserted;
      allRejected.push(...rejected);
      console.log(`  page at offset ${offset}: ${upserted}/${features.length} upserted`);

      if (features.length < PAGE_SIZE) break; // last page
      offset += PAGE_SIZE;
    }

    console.log(`\nDone. ${totalUpserted} parcels upserted.`);
    if (allRejected.length) {
      console.log(`${allRejected.length} record(s) skipped:`);
      for (const r of allRejected.slice(0, 50)) {
        console.log(`  - ${JSON.stringify(r)}`);
      }
      if (allRejected.length > 50) {
        console.log(`  ...and ${allRejected.length - 50} more.`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
