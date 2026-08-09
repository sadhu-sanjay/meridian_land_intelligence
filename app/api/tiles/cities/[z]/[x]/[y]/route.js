import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// Standard PostGIS ST_AsMVT tile query.
// - ST_TileEnvelope(z,x,y) gives the tile bounds in Web Mercator (3857).
// - We compare against the tile bounds transformed back to 4326 so the
//   existing GIST index on zoning_districts.geom (4326) is actually used
//   (the && operator is index-accelerated; ST_Intersects confirms it).
// - ST_AsMVTGeom clips/simplifies geometry to the tile in 3857 for output.
const TILE_QUERY = `
  WITH bounds AS (
    SELECT
      ST_TileEnvelope($1, $2, $3) AS merc_geom,
      ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS geo_geom
  ),
  mvtgeom AS (
    SELECT
      ST_AsMVTGeom(
        ST_Transform(zd.geom, 3857),
        bounds.merc_geom,
        4096,
        64,
        true
      ) AS geom,
      zd.id,
      zd.zone_code,
      zd.zone_desc,
      zd.acres
    FROM zoning_districts zd, bounds
    WHERE zd.geom && bounds.geo_geom
      AND ST_Intersects(zd.geom, bounds.geo_geom)
  )
  SELECT ST_AsMVT(mvtgeom, 'zoning_districts', 4096, 'geom') AS tile
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
      // Empty tile: 204 tells MapLibre "nothing here" without an error.
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
    console.error('Tile query failed:', err);
    return NextResponse.json({ error: 'Tile generation failed' }, { status: 500 });
  }
}
