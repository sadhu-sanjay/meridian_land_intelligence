import pool from '@/lib/db';


// GET /api/parcels/search?q=lummi+shore
//
// Matches against situs address (name), owner_name, taxpayer_name,
// geo_id, and prop_id. Requires the pg_trgm indexes from the parcels
// migration (parcels_name_trgm, parcels_owner_name_trgm,
// parcels_taxpayer_name_trgm) to stay fast at 180M-parcel scale —
// without them this ILIKE '%...%' query is a sequential scan.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return Response.json({ results: [] });
  }

  const like = `%${q}%`;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        geo_id,
        prop_id,
        name,
        owner_name,
        taxpayer_name,
        zoning,
        ST_X(surface_point) AS lng,
        ST_Y(surface_point) AS lat,
        GREATEST(
          similarity(coalesce(name, ''), $1),
          similarity(coalesce(owner_name, ''), $1),
          similarity(coalesce(taxpayer_name, ''), $1)
        ) AS score
      FROM parcels
      WHERE
        name ILIKE $2
        OR owner_name ILIKE $2
        OR taxpayer_name ILIKE $2
        OR geo_id ILIKE $2
        OR prop_id ILIKE $2
      ORDER BY score DESC NULLS LAST
      LIMIT 10
      `,
      [q, like]
    );

    return Response.json({ results: result.rows });
  } catch (err) {
    console.error("parcel search failed:", err);
    return Response.json({ error: "search failed" }, { status: 500 });
  }
}
