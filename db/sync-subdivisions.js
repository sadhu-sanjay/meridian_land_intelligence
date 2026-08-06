/**
 * sync-subdivisions.js
 *
 * Pulls subdivision polygons + attributes from Whatcom County's ArcGIS
 * WhatcomCo_Property/MapServer/3 ("Subdivisions") layer and upserts
 * them into `subdivisions`, keyed on `plat_number` (AuditorFileNumber).
 *
 * Same polygon-area pull pattern as sync-parcels-polygon.js — ArcGIS
 * does the spatial filtering server-side (geometry + spatialRel
 * params), so this never fetches more than the area defined by
 * AREA_POINTS below.
 *
 *   - missing/blank plat_number (AuditorFileNumber) -> record skipped,
 *                                                       reported at the end
 *   - missing/degenerate geometry     -> record skipped (ST_BuildArea guard)
 *   - any unexpected per-record error -> caught, that record skipped,
 *                                        rest of the page still processes
 *   - duplicate plat_number in a page -> last occurrence wins (re-plats /
 *                                        multi-phase subdivisions can share
 *                                        an AuditorFileNumber)
 *   - acreage                         -> not provided by this layer, so it's
 *                                        computed from the built geometry
 *                                        with ST_Area(geography) after insert
 *
 * Requires a UNIQUE constraint on subdivisions.plat_number for the
 * ON CONFLICT upsert below:
 *
 *   ALTER TABLE subdivisions ADD CONSTRAINT subdivisions_plat_number_key
 *     UNIQUE (plat_number);
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
//
// Kept identical to sync-parcels-polygon.js's AREA_POINTS by default —
// change both together if you want parcels and subdivisions synced
// from the same area.
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

// Confirmed against WhatcomCo_Property/MapServer/3 field listing:
// OBJECTID, Name, AuditorFileNumber, SubdivisionName, Shape, AF_URL.
// There's no acreage field on this layer — see note above.
const FIELD_MAP = {
  objectId: "OBJECTID",
  name: "Name",
  auditorFileNumber: "AuditorFileNumber",
  subdivisionName: "SubdivisionName",
};

const BASE_URL =
  "https://gis.whatcomcounty.us/arcgis/rest/services/EnterprisePublishing/WhatcomCo_Property/MapServer/3";
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
    // Spatial filter: only subdivisions that intersect AREA_RING.
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

// Coerces a raw attribute to a non-empty trimmed string, or null.
function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

async function upsertPage(client, features) {
  const rejected = [];
  // Keyed by plat_number so a duplicate within the same page overwrites
  // the earlier row instead of both landing in the same INSERT statement —
  // Postgres can't ON CONFLICT DO UPDATE the same row twice in one command.
  const byPlatNumber = new Map();
  let duplicateCount = 0;

  for (const f of features) {
    const attrs = f.attributes ?? {};
    const objectId = attrs[FIELD_MAP.objectId];

    try {
      const platNumber = toStringOrNull(attrs[FIELD_MAP.auditorFileNumber]);
      if (!platNumber) {
        rejected.push({ objectId, reason: "missing plat_number (AuditorFileNumber)" });
        continue;
      }

      const rings = ringsOf(f);
      if (!rings.length) {
        rejected.push({ objectId, platNumber, reason: "missing geometry" });
        continue;
      }

      // Build a MULTILINESTRING WKT from the raw rings — ST_BuildArea
      // figures out shells vs. holes server-side.
      const lines = rings
        .map((ring) => `(${ring.map(([x, y]) => `${x} ${y}`).join(",")})`)
        .join(",");

      if (byPlatNumber.has(platNumber)) duplicateCount++;

      byPlatNumber.set(platNumber, {
        name: toStringOrNull(attrs[FIELD_MAP.name]),
        subdivisionName: toStringOrNull(attrs[FIELD_MAP.subdivisionName]),
        wkt: `MULTILINESTRING(${lines})`,
      });
    } catch (err) {
      // Any unexpected shape (malformed rings, etc.) skips just this
      // record instead of aborting the page.
      rejected.push({ objectId, reason: `unexpected error: ${err.message}` });
    }
  }

  if (duplicateCount > 0) {
    console.warn(`  ${duplicateCount} duplicate plat_number(s) in this page — kept the last occurrence of each`);
  }

  const platNumbers = [];
  const names = [];
  const subdivisionNames = [];
  const wkts = [];

  for (const [platNumber, row] of byPlatNumber) {
    platNumbers.push(platNumber);
    names.push(row.name);
    subdivisionNames.push(row.subdivisionName);
    wkts.push(row.wkt);
  }

  if (platNumbers.length === 0) return { upserted: 0, rejected };

  const result = await client.query(
    `
    WITH built AS (
      SELECT
        plat_number,
        name,
        subdivision_name,
        ST_Multi(ST_BuildArea(ST_SetSRID(wkt::geometry, 4326))) AS geom
      FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[]
      ) AS t(plat_number, name, subdivision_name, wkt)
    )
    INSERT INTO subdivisions (plat_number, name, subdivision_name, acreage, geom)
    SELECT
      plat_number,
      name,
      subdivision_name,
      ROUND((ST_Area(geom::geography) / 4046.8564224)::numeric, 2) AS acreage,
      geom
    FROM built
    WHERE geom IS NOT NULL AND ST_IsValid(geom)
    ON CONFLICT (plat_number) DO UPDATE SET
      name = EXCLUDED.name,
      subdivision_name = EXCLUDED.subdivision_name,
      acreage = EXCLUDED.acreage,
      geom = EXCLUDED.geom
    RETURNING plat_number
    `,
    [platNumbers, names, subdivisionNames, wkts]
  );

  const upserted = result.rows.length;
  const succeeded = new Set(result.rows.map((r) => r.plat_number));
  for (const platNumber of platNumbers) {
    if (!succeeded.has(platNumber)) {
      rejected.push({ platNumber, reason: "invalid geometry (failed ST_IsValid after ST_BuildArea)" });
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
      `Syncing subdivisions inside the ${AREA_POINTS.length}-point area (starting at offset ${offset})...`
    );
    while (true) {
      let page;
      try {
        page = await fetchPage(offset);
      } catch (err) {
        console.error(
          `\nFailed to fetch page at offset ${offset} after ${MAX_RETRIES} attempts: ${err.message}`
        );
        console.error(`Resume later with: node sync-subdivisions.js ${offset}`);
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

    console.log(`\nDone. ${totalUpserted} subdivisions upserted.`);
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
