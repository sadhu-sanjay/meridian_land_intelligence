// scripts/sync/sync-cities.js

import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const URL =
  "https://gis.whatcomcounty.us/arcgis/rest/services/Applications/ParcelViewerAddOnData/MapServer/9/query?" +
  new URLSearchParams({
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    f: "json",
  });

async function fetchCities() {
  const response = await fetch(URL);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch cities: ${response.status}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      JSON.stringify(data.error, null, 2)
    );
  }

  return data.features || [];
}

function arcgisRingsToGeoJSON(rings) {
  return {
    type: "Polygon",
    coordinates: rings,
  };
}

async function upsertCity(client, feature) {
  const attrs = feature.attributes;

  const sourceOid = attrs.OBJECTID;
  const localId = attrs.LOCALID ?? null;
  const cityName = attrs.NAME ?? null;
  const cityType = attrs.GEOTYPE ?? null;

  if (!sourceOid) {
    throw new Error("Missing OBJECTID");
  }

  if (!cityName) {
    throw new Error("Missing NAME");
  }

  if (!feature.geometry?.rings?.length) {
    throw new Error("Missing rings");
  }

  const geojson = arcgisRingsToGeoJSON(
    feature.geometry.rings
  );

  await client.query(
    `
    INSERT INTO cities (
      source_oid,
      local_id,
      city_name,
      city_type,
      geom,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      ST_Multi(
        ST_MakeValid(
          ST_Transform(
            ST_SetSRID(
              ST_GeomFromGeoJSON($5),
              3857
            ),
            4326
          )
        )
      ),
      NOW()
    )
    ON CONFLICT (source_oid)
    DO UPDATE SET
      local_id = EXCLUDED.local_id,
      city_name = EXCLUDED.city_name,
      city_type = EXCLUDED.city_type,
      geom = EXCLUDED.geom,
      updated_at = NOW()
    `,
    [
      sourceOid,
      localId,
      cityName,
      cityType,
      JSON.stringify(geojson),
    ]
  );
}

async function syncCities() {
  console.log("");
  console.log("=================================");
  console.log("SYNCING WHATCOM CITIES");
  console.log("=================================");
  console.log("");

  const features = await fetchCities();

  console.log(
    `Found ${features.length} city records`
  );

  const client = await pool.connect();

  let imported = 0;
  let failed = 0;

  try {
    for (const feature of features) {
      try {
        await upsertCity(client, feature);

        imported++;

        console.log(
          `✓ ${feature.attributes.NAME}`
        );
      } catch (err) {
        failed++;

        console.error("");
        console.error(
          `✗ Failed city: ${feature.attributes?.NAME}`
        );
        console.error(err.message);
        console.error("");
      }
    }

    console.log("");
    console.log("=================================");
    console.log("SYNC COMPLETE");
    console.log("=================================");
    console.log(`Imported: ${imported}`);
    console.log(`Failed: ${failed}`);
    console.log("");
  } finally {
    client.release();
    await pool.end();
  }
}

syncCities().catch((err) => {
  console.error("");
  console.error("FATAL ERROR");
  console.error(err);
  console.error("");

  process.exit(1);
});