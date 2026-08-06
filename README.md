# Zoning Districts Viewer

Next.js app that serves `zoning_districts` straight out of PostGIS as
Mapbox Vector Tiles (`ST_AsMVT`) and renders them with MapLibre GL —
no separate tile server needed.

## How it works

- **`app/api/tiles/zoning/[z]/[x]/[y]/route.js`** — a Next.js route
  handler that runs a single `ST_AsMVT` query per tile request, using
  `ST_TileEnvelope` for the tile bounds and `&&` against your existing
  GIST index on `geom` so lookups stay fast even at country scale.
- **`app/page.js`** — a MapLibre GL map that adds that route as a
  vector source (`{z}/{x}/{y}.pbf`) and styles polygons by `zone_code`,
  with a click popup showing `zone_desc` and `acres`.

Nothing is pre-tiled or cached to disk — every tile is generated live
from the current table contents, so edits to `zoning_districts` show
up on refresh with no rebuild step.

## Setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local with your real DATABASE_URL (Neon or any Postgres+PostGIS)
npm run dev
```

Open http://localhost:3000.

## Notes / things to adjust

- **Initial map view** in `app/page.js` (`INITIAL_VIEW`) is set to
  Whatcom County, WA to match your existing parcel sync setup — change
  it if your data is elsewhere, or wire it up to `ST_Extent(geom)` from
  the DB on load if you want it to auto-fit.
- **Color palette** (`ZONE_COLOR_EXPR` in `app/page.js`) is a generic
  placeholder mapping common zone-code prefixes (R/C/I/A/F/OS) to
  colors. Swap in your actual `zone_code` values for a proper legend.
- **Basemap** uses raw OpenStreetMap raster tiles so there's no API key
  to configure. Swap the `basemap` source in `page.js` for a vector
  basemap (MapTiler, Stadia, etc.) if you want nicer styling.
- For very large datasets, consider adding a `geom_3857` generated
  column with its own GIST index if tile latency becomes an issue —
  the current query transforms on the fly, which is fine up to the
  ~100k–1M polygon range but transform cost adds up at very low zooms.
- This reads directly from `zoning_districts`; if you want the parcels
  layer alongside it (as in your parcel-viewer project), add a second
  route + source the same way, pointed at the `parcels` table.
