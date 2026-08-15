import pool from "@/lib/db";
// pool = your existing Postgres connection pool (already used elsewhere,
// e.g. /api/parcels/search) — reused here instead of creating a new one.

export async function findParcelsWithinArea({
  corners,
  cityId,
  sizeFilter,
  quickFilters = [],
}) {
  const conditions = [];
  const params = [];

  if (cityId) {
    // Search is scoped to a city picked from the dropdown — intersect
    // parcels straight against that city's stored geometry, no drawn
    // polygon needed.
    params.push(cityId);
    conditions.push(
      `ST_Intersects(geom, (SELECT geom FROM cities WHERE id = $${params.length}))`,
    );
  } else {
    if (!Array.isArray(corners) || corners.length !== 4) {
      throw new Error(
        "corners must be an array of 4 [lng, lat] pairs when no cityId is given",
      );
    }
    const ring = [...corners, corners[0]];
    const wkt = `POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;
    params.push(wkt);
    conditions.push(
      `ST_Intersects(geom, ST_SetSRID(ST_GeomFromText($${params.length}), 4326))`,
    );
  }

  // ---- Size filter (unchanged, just now relative to params.length) ----
  if (sizeFilter?.value) {
    const sqft = parseFloat(sizeFilter.value);
    const tolerance = (sizeFilter.tolerancePercent ?? 20) / 100;
    const acresLow = (sqft * (1 - tolerance)) / 43560;
    const acresHigh = (sqft * (1 + tolerance)) / 43560;
    params.push(acresLow, acresHigh);
    conditions.push(
      `acreage BETWEEN $${params.length - 1} AND $${params.length}`,
    );
  }

  if (quickFilters.includes("residential")) {
    conditions.push(`zoning ILIKE 'residential%'`);
  }

  const query = `
  SELECT id, geo_id, name, zoning, zoning_desc, acreage, market_value, prop_id,
         ST_AsGeoJSON(surface_point) AS centroid
  FROM parcels
  WHERE ${conditions.join(" AND ")}
`;

  const result = await pool.query(query, params);
  return result.rows;
}