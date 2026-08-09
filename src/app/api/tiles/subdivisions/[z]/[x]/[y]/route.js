import { NextResponse } from 'next/server';
import pool from '@/src/lib/db';

// Same shape as the parcels/zoning tile routes: the GIST index on
// subdivisions.geom is in 4326, so we filter with `&&` against bounds
// transformed back to 4326, then let ST_AsMVTGeom do the actual
// clip/simplify in 3857.
const TILE_QUERY = `
  WITH bounds AS (
    SELECT
      ST_TileEnvelope($1, $2, $3) AS merc_geom,
      ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS geo_geom
  ),
  mvtgeom AS (
    SELECT
      ST_AsMVTGeom(
        ST_Transform(s.geom, 3857),
        bounds.merc_geom,
        4096,
        64,
        true
      ) AS geom,
      s.id,
      s.name,
      s.subdivision_name,
      s.plat_number,
      s.acreage
    FROM subdivisions s, bounds
    WHERE s.geom && bounds.geo_geom
      AND ST_Intersects(s.geom, bounds.geo_geom)
  )
  SELECT ST_AsMVT(mvtgeom, 'subdivisions', 4096, 'geom') AS tile
  FROM mvtgeom;
`;

export async function GET(_request, { params }) {
  const z = parseInt(params.z, 10);
  const x = parseInt(params.x, 10);
  const y = parseInt(params.y.replace(/\.pbf$/, ''), 10);

  if (
    !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) ||
    z < 0 || z > 24
  ) {
    return NextResponse.json({ error: 'Invalid tile coordinates' }, { status: 400 });
  }

  try {
    const result = await pool.query(TILE_QUERY, [z, x, y]);
    const tile = result.rows[0]?.tile;

    if (!tile || tile.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    return new NextResponse(tile, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-protobuf',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('Subdivisions tile query failed:', err);
    return NextResponse.json({ error: 'Tile generation failed' }, { status: 500 });
  }
}
