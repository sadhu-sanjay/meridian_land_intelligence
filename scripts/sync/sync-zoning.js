/**
 * sync-zoning.js
 *
 * Pulls zoning-district polygons from Whatcom County's ArcGIS
 * WhatcomCo_Planning/MapServer/0 (Zoning) layer and upserts them into
 * `zoning_districts`, keyed on the source OBJECTID.
 *
 * Same shape as sync-parcels.js on purpose:
 *   - Esri returns polygon rings with no shell/hole labeling, so raw
 *     rings go to Postgres as a MULTILINESTRING and get resolved with
 *     ST_BuildArea (handles winding order correctly without reimplementing
 *     ring-orientation math in JS).
 *   - ST_Multi(...) forces the result to MultiPolygon so it matches the
 *     column type even for single-ring districts.
 *   - Bad/degenerate geometry doesn't abort the whole page — rows that
 *     don't resolve are filtered out and reported at the end.
 *   - Idempotent: re-running after a failure just re-upserts, no dupes.
 *
 * Field mapping confirmed via inspect-zoning-fields.js against Whatcom's
 * actual Zoning layer:
 *   OBJECTID           -> source_oid (upsert key)
 *   ZONING             -> zone_code  (e.g. "FEDERAL" — this is the layer's
 *                                     display field; values are full words
 *                                     in places, not always a short code)
 *   COMPREHENSIVE_PLAN -> zone_desc  (closest available descriptive field —
 *                                     Whatcom's layer has no separate
 *                                     long-form description column)
 *   ACRES              -> acres      (district polygon size, bonus field)
 */

require("dotenv").config();
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — check your .env file.");
  process.exit(1);
}

const FIELD_MAP = {
  objectId: "OBJECTID",
  code: "ZONING",
  description: "COMPREHENSIVE_PLAN",
  acres: "ACRES",
};

const BASE_URL =
  "https://gis.whatcomcounty.us/arcgis/rest/services/EnterprisePublishing/WhatcomCo_Planning/MapServer/0";
const PAGE_SIZE = 500;
const MAX_RETRIES = 3;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: `${FIELD_MAP.objectId},${FIELD_MAP.code},${FIELD_MAP.description},${FIELD_MAP.acres}`,
    outSR: "4326",
    f: "json",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
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

async function upsertPage(client, features) {
  const rejected = [];
  let upserted = 0;

  // One multi-row statement per page via unnest(), same batching approach
  // sync-parcels.js uses for the `parcels` table.
  const objectIds = [];
  const codes = [];
  const descs = [];
  const acresVals = [];
  const wkts = [];

  for (const f of features) {
    const attrs = f.attributes;
    const rings = ringsOf(f);
    if (!rings.length) {
      rejected.push(attrs[FIELD_MAP.objectId]);
      continue;
    }
    // Build a MULTILINESTRING WKT from the raw rings — ST_BuildArea
    // figures out shells vs. holes server-side.
    const lines = rings
      .map((ring) => `(${ring.map(([x, y]) => `${x} ${y}`).join(",")})`)
      .join(",");
    objectIds.push(attrs[FIELD_MAP.objectId]);
    codes.push(attrs[FIELD_MAP.code] ?? null);
    descs.push(attrs[FIELD_MAP.description] ?? null);
    acresVals.push(attrs[FIELD_MAP.acres] ?? null);
    wkts.push(`MULTILINESTRING(${lines})`);
  }

  if (objectIds.length === 0) return { upserted: 0, rejected };

  const result = await client.query(
    `
    WITH built AS (
      SELECT
        oid,
        code,
        description,
        acres,
        ST_Multi(ST_BuildArea(ST_SetSRID(wkt::geometry, 4326))) AS geom
      FROM unnest(
        $1::int[], $2::text[], $3::text[], $4::numeric[], $5::text[]
      ) AS t(oid, code, description, acres, wkt)
    )
    INSERT INTO zoning_districts (source_oid, zone_code, zone_desc, acres, geom)
    SELECT oid, code, description, acres, geom
    FROM built
    WHERE geom IS NOT NULL AND ST_IsValid(geom)
    ON CONFLICT (source_oid) DO UPDATE SET
      zone_code = EXCLUDED.zone_code,
      zone_desc = EXCLUDED.zone_desc,
      acres = EXCLUDED.acres,
      geom = EXCLUDED.geom
    RETURNING source_oid
    `,
    [objectIds, codes, descs, acresVals, wkts],
  );

  upserted = result.rows.length;
  const succeeded = new Set(result.rows.map((r) => r.source_oid));
  for (const oid of objectIds) {
    if (!succeeded.has(oid)) rejected.push(oid);
  }

  return { upserted, rejected };
}

async function main() {
  const client = await pool.connect();
  let offset = 0;
  let totalUpserted = 0;
  const allRejected = [];

  try {
    console.log("Syncing zoning districts from Whatcom County ArcGIS...");
    while (true) {

      const page = await fetchPage(offset);
      const features = page.features || [];
      if (features.length === 0) break;

      const { upserted, rejected } = await upsertPage(client, features);
      totalUpserted += upserted;
      allRejected.push(...rejected);
      console.log(` page at offset ${offset}: ${upserted}/${features.length} upserted`);

      if (features.length < PAGE_SIZE) break; // last page
      offset += PAGE_SIZE;
    }

    console.log(`\nDone. ${totalUpserted} zoning districts upserted.`);
    if (allRejected.length) {
      console.log(
        `${allRejected.length} rows had invalid/degenerate geometry and were skipped ` +
          `(source OBJECTIDs: ${allRejected.join(", ")}) — review manually if needed.`,
      );
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
