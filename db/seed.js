// Generates a grid of synthetic parcels so you can test vector-tile
// loading, search, labels, and zoning colors without a real county
// dataset. After seeding, run `npm run db:zones` to dissolve the
// synthetic zoning values into zoning_districts for the overlay layer.
//
// Usage: node --env-file=.env db/seed.js [count]
// Default count is 100000 to exercise the vector-tile path at a scale
// closer to what this architecture is meant for.
const { Client } = require("pg");

const ZONINGS = ["residential", "commercial", "agricultural", "industrial"];

// Roughly centered on the placeholder map view in ParcelMap.tsx.
// Change these to your county's bounding box.
const ORIGIN_LNG = -122.55;
const ORIGIN_LAT = 48.72;
const STEP = 0.0015; // ~150m grid spacing at this latitude

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set (check your .env file).");
    process.exit(1);
  }
  const count = Number(process.argv[2]) || 100000;
  const cols = Math.ceil(Math.sqrt(count));

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await client.connect();

  console.log(`Seeding ${count} synthetic parcels...`);
  await client.query("BEGIN");
  try {
    await client.query("TRUNCATE parcels RESTART IDENTITY");

    const batchSize = 500;
    let batch = [];

    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const lng = ORIGIN_LNG + col * STEP;
      const lat = ORIGIN_LAT + row * STEP;
      const w = lng + STEP * 0.85;
      const n = lat + STEP * 0.85;

      const geoId = `PN-${String(i + 1).padStart(6, "0")}`;
      const zoning = ZONINGS[i % ZONINGS.length];
      const acreage = (0.25 + (i % 7) * 0.3).toFixed(2);
      const marketValue = Math.round(Number(acreage) * (15000 + (i % 5) * 4000));
      const score = Math.round(40 + ((i * 37) % 60));
      const propId = `WC-${String(i + 1).padStart(6, "0")}`;
      const polygonWkt = `POLYGON((${lng} ${lat}, ${w} ${lat}, ${w} ${n}, ${lng} ${n}, ${lng} ${lat}))`;

      batch.push({ geoId, zoning, acreage, marketValue, score, propId, polygonWkt });

      if (batch.length === batchSize || i === count - 1) {
        const values = [];
        const params = [];
        batch.forEach((p, idx) => {
          const base = idx * 7;
          values.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ST_Multi(ST_GeomFromText($${base + 7}, 4326)))`
          );
          params.push(p.geoId, p.zoning, p.acreage, p.marketValue, p.score, p.propId, p.polygonWkt);
        });

        await client.query(
          // surface_point is a generated column (ST_PointOnSurface(geom))
          // — Postgres computes it automatically, don't insert it here.
          `INSERT INTO parcels (geo_id, zoning, acreage, market_value, score, prop_id, geom)
           VALUES ${values.join(",")}`,
          params
        );
        batch = [];
      }
    }

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
