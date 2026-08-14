import pool from "@/lib/db";
// pool = your existing Postgres connection pool (already used elsewhere,
// e.g. /api/parcels/search) — reused here instead of creating a new one.

// This function takes the 4 map-drawn corners plus whatever filters the
// sidebar currently has active, and returns the parcels matching ALL of
// them (AND logic — every active filter narrows the result further).
export async function findParcelsWithinArea({
  corners,
  sizeFilter,
  quickFilters = [],
}) {
  // corners looks like: [[lng1,lat1], [lng2,lat2], [lng3,lat3], [lng4,lat4]]
  // A polygon in PostGIS must be "closed" — its first and last point must
  // match — so we copy the first corner onto the end of the array.
  const ring = [...corners, corners[0]];

  // PostGIS understands polygons written as WKT (Well-Known Text), a
  // plain-text format like: POLYGON((lng1 lat1, lng2 lat2, ..., lng1 lat1))
  // This line builds that string from our 5-point ring (4 corners + repeat
  // of the first one to close it).
  const wkt = `POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;

  // We build the SQL WHERE clause piece by piece, since not every filter
  // is always active. `conditions` holds each SQL fragment; `params` holds
  // the actual values, matched up by position ($1, $2, $3...) — this is
  // how you avoid SQL injection: values never get pasted into the string
  // directly, they're passed separately and Postgres substitutes them safely.

  // The area filter is always required (you can't search without having
  // drawn a shape), so it starts the list rather than being conditionally
  // added like the others below.
  const conditions = [
    `ST_Intersects(geom, ST_SetSRID(ST_GeomFromText($1), 4326))`,
  ];
  // ST_GeomFromText($1)  → turns our WKT string into a PostGIS geometry
  // ST_SetSRID(..., 4326) → tags that geometry as using SRID 4326, the
  //                          standard lng/lat coordinate system (same one
  //                          your parcels.geom column already uses — they
  //                          have to match or the comparison is meaningless)
  // ST_Intersects(geom, ...) → true if a parcel's shape touches/overlaps
  //                             our drawn polygon at all (even partially)
  const params = [wkt]; // $1 in the query above = this WKT string

  // ---- Size filter (only added if the user actually set one) ----
  if (sizeFilter?.value) {
    const sqft = parseFloat(sizeFilter.value); // sidebar sends a string, e.g. "600"

    // Same ±20% tolerance band logic already used in the sidebar's preview
    // text — "around 600 sqft" becomes a range, not an exact match.
    const tolerance = (sizeFilter.tolerancePercent ?? 20) / 100;

    // parcels.acreage is stored in acres, not sqft — so convert the sqft
    // range into an acreage range before comparing (43,560 sqft = 1 acre).
    const acresLow = (sqft * (1 - tolerance)) / 43560;
    const acresHigh = (sqft * (1 + tolerance)) / 43560;

    // Push both values onto params — they become $2 and $3 (since $1 is
    // already taken by the WKT string above).
    params.push(acresLow, acresHigh);

    // params.length is now 3 (wkt, acresLow, acresHigh) — so the low value
    // is at position params.length - 1 (which is $2) and high is at
    // params.length (which is $3). This keeps the placeholder numbers
    // correct even though we don't hardcode "$2"/"$3" directly.
    conditions.push(
      `acreage BETWEEN $${params.length - 1} AND $${params.length}`,
    );
  }

  // ---- Quick filter: residential (the only one with real backing data) ----
  // "vacant_lots" and "vacant_structures" are deliberately NOT handled
  // here — there's no column yet that says whether a parcel has a
  // building on it, so silently filtering on them would return a
  // confidently wrong answer. Leaving them out of the query just means
  // they don't narrow results yet, rather than narrowing incorrectly.
  if (quickFilters.includes("residential")) {
    // ILIKE = case-insensitive LIKE. 'residential%' matches any zoning
    // value that STARTS WITH "residential" (e.g. "Residential Low
    // Density"), not just an exact "residential" string.
    conditions.push(`zoning ILIKE 'residential%'`);
  }

  const query = `
  SELECT id, geo_id, name, zoning, zoning_desc, acreage, market_value, prop_id,
         ST_AsGeoJSON(surface_point) AS centroid
  FROM parcels
  WHERE ${conditions.join(" AND ")}
`;

  console.log("query", query, "params", params);
  // Run the query with our positional params array — pool.query matches
  // $1, $2, $3... in the SQL string to params[0], params[1], params[2]...
  const result = await pool.query(query, params);

  console.log("found parcels:", result.rows.length);
  // pool.query returns lots of metadata (row count, field types, etc.) —
  // we only care about the actual rows, so that's all we return.
  return result.rows;
}
