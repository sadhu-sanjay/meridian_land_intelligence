'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

// Adjust this to wherever your zoning_districts data actually sits.
// (Defaulting to Whatcom County, WA to match the existing parcel sync setup.)
const INITIAL_VIEW = { lng: -122.35, lat: 48.75, zoom: 10 };
const LOCATION_LABEL = 'Whatcom County, WA — Chuckanut / Samish Corridor';

const DEFAULT_COLOR = '#8FA08F';
const SUBDIVISION_COLOR = '#9f5609';

// Parcels only render once you're zoomed in enough to make individual
// boundaries/labels meaningful — below this it's just noise (and a lot
// of geometry for no visual benefit). Zoning stays visible at every zoom.
const PARCEL_MIN_ZOOM = 13;
// Labels specifically wait even longer than the fill/outline, so text
// doesn't turn into overlapping clutter the moment parcels appear.
const PARCEL_LABEL_MIN_ZOOM = 15;
const ZONE_LABEL_MIN_ZOOM = 11;
// Subdivisions sit between zoning (always visible) and parcels (zoom 13+)
// in granularity, so they show up a bit before parcels do.
const SUBDIVISION_MIN_ZOOM = 12;
const SUBDIVISION_LABEL_MIN_ZOOM = 13;

const MAX_COMPARE = 3;

// Layer modes exposed as the sidebar toggle buttons. Each jumps the view
// to a zoom band where that layer is the dominant thing on screen — the
// underlying zoom-based visibility (zoning always on, parcels 13+,
// subdivisions 11+) doesn't change, this just gets you there in one click.
const MODES = {
  zoning: { label: 'Zoning', zoom: 10.5 },
  subdivisions: { label: 'Subdivisions', zoom: 12.5 },
  parcels: { label: 'Parcels', zoom: 15 },
};

// Deterministic, maximally-spread color per index using the golden-angle
// hue rotation — the Nth zone_code always gets the same color, and
// neighboring indices land far apart on the color wheel so adjacent
// legend entries stay visually distinct even with 20+ zones.
function colorForIndex(i) {
  const hue = (i * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 55%, 48%)`;
}

function boundsOfGeometry(geometry) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(walk);
    }
  };
  walk(geometry.coordinates);
  if (!Number.isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

function fmtAcres(n) {
  return Number.isFinite(Number(n)) ? `${Number(n).toFixed(2)} ac` : '—';
}

export default function Page() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const colorMapRef = useRef(new Map()); // zone_code -> color, assigned once, stable
  const [selected, setSelected] = useState(null); // drawer contents
  const [loadError, setLoadError] = useState(null);
  const [legend, setLegend] = useState([]); // [{ code, desc, color }]
  const [mode, setMode] = useState('zoning');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [minAcreage, setMinAcreage] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchError, setSearchError] = useState(null);
  const [stats, setStats] = useState({ inView: 0, avgAcreage: null, loaded: 0 });
  const [ranked, setRanked] = useState([]);
  const [compareItems, setCompareItems] = useState([]); // parcel summaries
  const [compareOpen, setCompareOpen] = useState(false);

  const minAcreageRef = useRef(minAcreage);
  useEffect(() => { minAcreageRef.current = minAcreage; }, [minAcreage]);

  const zoneColor = (code) => colorMapRef.current.get(code) || DEFAULT_COLOR;
  const zoneDesc = (code) => legend.find((z) => z.code === code)?.desc;

  // Looks at whatever zoning features are currently loaded on screen,
  // assigns any new zone_codes a color (existing ones keep theirs), then
  // pushes the resulting match expression into the layer paint and
  // updates the legend list.
  const refreshZoneColors = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer('zoning-fill')) return;

    const features = map.querySourceFeatures('zoning', {
      sourceLayer: 'zoning_districts',
    });

    const descByCode = new Map();
    for (const f of features) {
      const code = f.properties?.zone_code;
      if (!code) continue;
      if (!descByCode.has(code)) descByCode.set(code, f.properties?.zone_desc);
    }

    const colorMap = colorMapRef.current;
    let added = false;
    for (const code of [...descByCode.keys()].sort()) {
      if (!colorMap.has(code)) {
        colorMap.set(code, colorForIndex(colorMap.size));
        added = true;
      }
    }
    if (!added && legend.length > 0) return; // nothing new, skip re-render

    const matchExpr = ['match', ['get', 'zone_code']];
    for (const [code, color] of colorMap.entries()) {
      matchExpr.push(code, color);
    }
    matchExpr.push(DEFAULT_COLOR);

    map.setPaintProperty('zoning-fill', 'fill-color', matchExpr);
    map.setPaintProperty('zoning-outline', 'line-color', matchExpr);

    setLegend(
      [...colorMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([code, color]) => ({ code, color, desc: descByCode.get(code) }))
    );
  };

  // Recomputes the "in view / avg acreage / loaded" stat tiles and the
  // ranked-parcels list, respecting the current min-acreage filter.
  const refreshParcelStats = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer('parcels-fill')) return;

    const minAc = minAcreageRef.current;

    const rendered = map.queryRenderedFeatures({ layers: ['parcels-fill'] });
    const loadedAll = map.querySourceFeatures('parcels', { sourceLayer: 'parcels' });

    const dedupe = (feats) => {
      const byId = new Map();
      for (const f of feats) {
        const acreage = Number(f.properties?.acreage);
        if (Number.isFinite(acreage) && acreage < minAc) continue;
        const key = f.id ?? f.properties?.geo_id ?? JSON.stringify(f.properties);
        if (!byId.has(key)) byId.set(key, f);
      }
      return [...byId.values()];
    };

    const inViewFeatures = dedupe(rendered);
    const loadedFeatures = dedupe(loadedAll);

    const acreages = inViewFeatures
      .map((f) => Number(f.properties?.acreage))
      .filter((n) => Number.isFinite(n));
    const avgAcreage = acreages.length
      ? acreages.reduce((a, b) => a + b, 0) / acreages.length
      : null;

    setStats({ inView: inViewFeatures.length, avgAcreage, loaded: loadedFeatures.length });

    setRanked(
      inViewFeatures
        .filter((f) => Number.isFinite(Number(f.properties?.acreage)))
        .sort((a, b) => Number(b.properties.acreage) - Number(a.properties.acreage))
        .slice(0, 25)
        .map((f) => ({
          propId: f.properties.prop_id,
          geoId: f.properties.geo_id,
          name: f.properties.name,
          zoning: f.properties.zoning,
          acreage: f.properties.acreage,
          geometry: f.geometry,
        }))
    );
  };

  const applyParcelFilter = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer('parcels-fill')) return;
    const minAc = minAcreageRef.current;
    const filter = minAc > 0 ? ['>=', ['coalesce', ['get', 'acreage'], 0], minAc] : null;
    map.setFilter('parcels-fill', filter);
    map.setFilter('parcels-outline', filter);
    map.setFilter('parcels-label', filter);
    refreshParcelStats();
  };

  const applyZoneFilter = (code) => {
    const map = mapRef.current;
    if (!map || !map.getLayer('zoning-fill')) return;
    const filter = code && code !== 'all' ? ['==', ['get', 'zone_code'], code] : null;
    map.setFilter('zoning-fill', filter);
    map.setFilter('zoning-outline', filter);
    map.setFilter('zoning-label', filter);
  };

  const flyToFeature = (feature) => {
    const map = mapRef.current;
    if (!map || !feature?.geometry) return;
    const bounds = boundsOfGeometry(feature.geometry);
    if (bounds) map.fitBounds(bounds, { padding: 120, maxZoom: 17, duration: 600 });
  };

  const openParcelDrawer = (props) => {
    setSelected({
      kind: 'parcel',
      propId: props.prop_id ?? props.propId,
      geoId: props.geo_id ?? props.geoId,
      name: props.name,
      zoning: props.zoning,
      acreage: props.acreage,
    });
  };

  const handleSelectRanked = (parcel) => {
    openParcelDrawer(parcel);
    flyToFeature(parcel);
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: MODES[nextMode].zoom, duration: 500 });
  };

  const toggleCompare = (parcel) => {
    const geoId = parcel.geo_id ?? parcel.geoId;
    if (!geoId) return;
    setCompareItems((prev) => {
      if (prev.some((c) => c.geoId === geoId)) {
        return prev.filter((c) => c.geoId !== geoId);
      }
      if (prev.length >= MAX_COMPARE) return prev;
      return [
        ...prev,
        {
          geoId,
          propId: parcel.prop_id ?? parcel.propId,
          name: parcel.name,
          zoning: parcel.zoning,
          acreage: parcel.acreage,
        },
      ];
    });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearchError(null);
    const map = mapRef.current;
    const query = searchText.trim();
    if (!map || !query) return;

    // Try a zone code match first.
    const zoneMatch = legend.find((z) => z.code.toLowerCase() === query.toLowerCase());
    if (zoneMatch) {
      setZoneFilter(zoneMatch.code);
      applyZoneFilter(zoneMatch.code);
      handleModeChange('zoning');
      return;
    }

    // Otherwise search loaded parcels by prop_id (substring, case-insensitive).
    const parcelFeatures = map.querySourceFeatures('parcels', { sourceLayer: 'parcels' });
    const hit = parcelFeatures.find((f) =>
      String(f.properties?.prop_id ?? '').toLowerCase().includes(query.toLowerCase())
    );
    if (hit) {
      openParcelDrawer(hit.properties);
      handleModeChange('parcels');
      flyToFeature(hit);
      return;
    }

    setSearchError('No loaded parcel or zone matches that search.');
  };

  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        // Required for any layer using a symbol "text-field" (both label
        // layers below) — without this MapLibre throws
        // "layout.text-field requires glyphs" and labels never render.
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        sources: {
          'esri-imagery': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
          },
          'esri-boundaries': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
          },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'esri-imagery' },
          { id: 'boundaries', type: 'raster', source: 'esri-boundaries', paint: { 'raster-opacity': 0.85 } },
        ],
      },
      center: [INITIAL_VIEW.lng, INITIAL_VIEW.lat],
      zoom: INITIAL_VIEW.zoom,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.addSource('zoning', {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tiles/zoning/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 12,
      });

      map.addLayer({
        id: 'zoning-fill',
        type: 'fill',
        source: 'zoning',
        maxzoom: 13.5,
        'source-layer': 'zoning_districts',
        paint: {
          'fill-color': DEFAULT_COLOR, // replaced with a per-zone match expr once tiles load
          'fill-opacity': 0.5,
        },
      });

      map.addLayer({
        id: 'zoning-outline',
        type: 'line',
        source: 'zoning',
        'source-layer': 'zoning_districts',
        paint: {
          'line-color': '#efe7d2',
          'line-width': 1,
          'line-opacity': 0.7,
        },
      });

      map.addLayer({
        id: 'zoning-label',
        type: 'symbol',
        source: 'zoning',
        'source-layer': 'zoning_districts',
        minzoom: ZONE_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'zone_code'],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': '#efe7d2',
          'text-halo-color': '#141c17',
          'text-halo-width': 1.2,
        },
      });

      // --- Parcels ---
      map.addSource('parcels', {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tiles/parcels/{z}/{x}/{y}.pbf`],
        minzoom: PARCEL_MIN_ZOOM,
        maxzoom: 22,
        promoteId: 'id',
      });

      map.addLayer({
        id: 'parcels-fill',
        type: 'fill',
        source: 'parcels',
        'source-layer': 'parcels',
        minzoom: PARCEL_MIN_ZOOM,
        paint: {
          'fill-color': '#c9922f',
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.55,
            0.16,
          ],
        },
      });

      map.addLayer({
        id: 'parcels-outline',
        type: 'line',
        source: 'parcels',
        'source-layer': 'parcels',
        minzoom: PARCEL_MIN_ZOOM,
        paint: {
          'line-color': '#efe7d2',
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.1],
        },
      });

      map.addLayer({
        id: 'parcels-label',
        type: 'symbol',
        source: 'parcels',
        'source-layer': 'parcels',
        minzoom: PARCEL_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'prop_id'],
          'text-size': 11,
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': '#efe7d2',
          'text-halo-color': '#141c17',
          'text-halo-width': 1.2,
        },
      });

      // --- Subdivisions ---
      map.addSource('subdivisions', {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tiles/subdivisions/{z}/{x}/{y}.pbf`],
        minzoom: SUBDIVISION_MIN_ZOOM,
        maxzoom: 16,
      });

      map.addLayer({
        id: 'subdivisions-fill',
        type: 'fill',
        source: 'subdivisions',
        'source-layer': 'subdivisions',
        minzoom: SUBDIVISION_MIN_ZOOM,
        paint: {
          'fill-color': SUBDIVISION_COLOR,
          'fill-opacity': 0.2,
        },
      });

      map.addLayer({
        id: 'subdivisions-outline',
        type: 'line',
        source: 'subdivisions',
        'source-layer': 'subdivisions',
        minzoom: SUBDIVISION_MIN_ZOOM,
        paint: {
          'line-color': SUBDIVISION_COLOR,
          'line-width': 2.5,
        },
      });

      map.addLayer({
        id: 'subdivisions-label',
        type: 'symbol',
        source: 'subdivisions',
        'source-layer': 'subdivisions',
        minzoom: SUBDIVISION_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'subdivision_name'],
          'text-size': 11,
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': '#d9c9ea',
          'text-halo-color': '#141c17',
          'text-halo-width': 1.2,
        },
      });

      map.on('click', 'subdivisions-fill', (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        setSelected({
          kind: 'subdivision',
          name: feature.properties.name,
          subdivisionName: feature.properties.subdivision_name,
          platNumber: feature.properties.plat_number,
          acreage: feature.properties.acreage,
        });
      });
      map.on('mouseenter', 'subdivisions-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'subdivisions-fill', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'parcels-fill', (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        openParcelDrawer(feature.properties);
      });
      map.on('mouseenter', 'parcels-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'parcels-fill', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'zoning-fill', (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        setSelected({
          kind: 'zoning',
          zone_code: feature.properties.zone_code,
          zone_desc: feature.properties.zone_desc,
          acres: feature.properties.acres,
        });
      });
      map.on('mouseenter', 'zoning-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'zoning-fill', () => { map.getCanvas().style.cursor = ''; });

      // Re-derive the zone_code -> color legend and the parcel stat tiles
      // whenever new tiles have finished loading (pan/zoom reveals new
      // features, initial load, etc).
      map.on('idle', refreshZoneColors);
      map.on('idle', refreshParcelStats);
    });

    map.on('error', (e) => {
      // Surfaces tile/network errors (e.g. DB not reachable) in the UI
      // instead of failing silently.
      if (e?.error?.message) setLoadError(e.error.message);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Highlights the selected parcel on the map (feature-state driven fill/
  // outline emphasis defined in the layer paint above) as the drawer opens
  // and closes, without re-adding layers or losing the current viewport.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('parcels')) return;
    map.removeFeatureState({ source: 'parcels', sourceLayer: 'parcels' });
    if (selected?.kind === 'parcel') {
      const hit = map
        .querySourceFeatures('parcels', { sourceLayer: 'parcels' })
        .find((f) => f.properties?.geo_id === selected.geoId);
      if (hit?.id != null) {
        map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: hit.id }, { selected: true });
      }
    }
  }, [selected]);

  const closeDrawer = () => setSelected(null);
  const isComparing = (geoId) => compareItems.some((c) => c.geoId === geoId);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark">M</div>
          <h1>Meridian</h1>
          <span className="tag">Land Intelligence</span>
        </div>
        <div className="topbar-right">
          <span className="locus">{LOCATION_LABEL}</span>
          <span className="demo-pill">Live &middot; PostGIS</span>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-section">
            <p className="eyebrow">Search &amp; Layer</p>
            <form className="searchrow" onSubmit={handleSearch}>
              <input
                type="text"
                placeholder="Search parcel, zoning, corridor…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </form>
            {searchError && <p className="search-error">{searchError}</p>}
            <div className="layer-toggle">
              {Object.entries(MODES).map(([key, m]) => (
                <button
                  key={key}
                  type="button"
                  className={mode === key ? 'active' : ''}
                  onClick={() => handleModeChange(key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <p className="eyebrow">Filters</p>
            <div className="filterrow">
              <label>Zoning</label>
              <select
                value={zoneFilter}
                onChange={(e) => {
                  setZoneFilter(e.target.value);
                  applyZoneFilter(e.target.value);
                }}
              >
                <option value="all">All zoning types</option>
                {legend.map((z) => (
                  <option key={z.code} value={z.code}>
                    {z.code}
                    {z.desc ? ` — ${z.desc}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="filterrow" style={{ marginTop: 8 }}>
              <label>Min acreage</label>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={minAcreage}
                onChange={(e) => setMinAcreage(Number(e.target.value))}
                onMouseUp={applyParcelFilter}
                onTouchEnd={applyParcelFilter}
              />
              <span className="slider-value">{minAcreage}</span>
            </div>
            <div className="stats-strip">
              <div>
                <b>{stats.inView}</b>
                <span>In view</span>
              </div>
              <div>
                <b>{stats.avgAcreage != null ? stats.avgAcreage.toFixed(1) : '—'}</b>
                <span>Avg Acres</span>
              </div>
              <div>
                <b>{stats.loaded}</b>
                <span>Loaded</span>
              </div>
            </div>
          </div>

          <div className="sidebar-section" style={{ paddingBottom: 8, borderBottom: 'none' }}>
            <p className="eyebrow">Ranked Parcels</p>
          </div>
          <div className="list">
            {ranked.length === 0 ? (
              <p className="empty-note">No parcels match these filters in view.</p>
            ) : (
              ranked.map((p) => {
                const color = zoneColor(p.zoning);
                const desc = zoneDesc(p.zoning);
                const isSelected = selected?.kind === 'parcel' && selected.geoId === p.geoId;
                return (
                  <div
                    key={p.geoId ?? p.propId}
                    className={`card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectRanked(p)}
                  >
                    <input
                      type="checkbox"
                      className="compare-check"
                      checked={isComparing(p.geoId)}
                      title="Add to compare"
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleCompare(p)}
                    />
                    <div className="card-top">
                      <div>
                        <h3>{p.name || 'Unnamed parcel'}</h3>
                        <p className="card-loc">{p.geoId}</p>
                      </div>
                      <div className="score-chip" style={{ background: color }} />
                    </div>
                    <div className="card-meta">
                      <span>{fmtAcres(p.acreage)}</span>
                      <span>{p.zoning || '—'}</span>
                    </div>
                    <span className="grade-label" style={{ color }}>
                      {p.zoning || 'Unzoned'}
                      {desc ? ` · ${desc}` : ''}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className={`compare-bar ${compareItems.length > 0 ? 'show' : ''}`}>
            <span>{compareItems.length} selected (max {MAX_COMPARE})</span>
            <button onClick={() => setCompareOpen(true)}>Compare parcels →</button>
          </div>
        </aside>

        <div className="mapwrap">
          <div ref={mapContainerRef} className="map-canvas" />

          {loadError && <div className="load-error">Error: {loadError}</div>}

          {/* {legend.length > 0 && (
            <div className="legend">
              <p className="eyebrow">Zones</p>
              {legend.map((z) => (
                <div key={z.code} className="legend-row">
                  <span className="legend-swatch" style={{ background: z.color }} />
                  <span>
                    {z.code}
                    {z.desc ? ` — ${z.desc}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )} */}

        </div>

        <div className={`drawer ${selected ? 'open' : ''}`}>
          {selected?.kind === 'parcel' && (
            <>
              <div className="drawer-head">
                <button className="drawer-close" onClick={closeDrawer}>✕</button>
                <p className="drawer-eyebrow">Parcel Dossier</p>
                <h2>{selected.name || 'Unnamed parcel'}</h2>
                <p className="sub">
                  {selected.geoId} · {fmtAcres(selected.acreage)} · {selected.zoning || '—'}
                </p>
              </div>
              <div className="drawer-block">
                <h4>Parcel Facts</h4>
                <div className="kv-grid">
                  <div><b>Acreage</b>{fmtAcres(selected.acreage)}</div>
                  <div><b>Zoning</b>{zoneDesc(selected.zoning) || selected.zoning || '—'}</div>
                  <div><b>Prop ID</b>{selected.propId || '—'}</div>
                  <div><b>Geo ID</b>{selected.geoId || '—'}</div>
                </div>
              </div>
              <div className="drawer-actions">
                <button className="btn-primary" onClick={() => toggleCompare(selected)}>
                  {isComparing(selected.geoId) ? 'Remove from compare' : 'Add to compare'}
                </button>
                <button className="btn-ghost" onClick={closeDrawer}>Close</button>
              </div>
            </>
          )}

           {selected?.kind === 'zoning' && (
            <>
              <div className="drawer-head">
                <button className="drawer-close" onClick={closeDrawer}>✕</button>
                <p className="drawer-eyebrow">Zoning District</p>
                <h2 style={{ color: zoneColor(selected.zone_code) }}>{selected.zone_code || 'Unknown zone'}</h2>
                <p className="sub">{selected.zone_desc || '—'}</p>
              </div>
              <div className="drawer-block">
                <h4>District Facts</h4>
                <div className="kv-grid">
                  <div><b>Zone Code</b>{selected.zone_code || '—'}</div>
                  <div><b>Comp Plan</b>{selected.zone_desc || '—'}</div>
                  <div><b>Acreage</b>{selected.acres != null ? `${Number(selected.acres).toFixed(1)} ac` : '—'}</div>
                </div>
              </div>
              <div className="drawer-actions">
                <button className="btn-ghost" onClick={closeDrawer}>Close</button>
              </div>
            </>
          )} 

          {selected?.kind === 'subdivision' && (
            <>
              <div className="drawer-head">
                <button className="drawer-close" onClick={closeDrawer}>✕</button>
                <p className="drawer-eyebrow">Subdivision</p>
                <h2>{selected.subdivisionName || selected.name || 'Unknown subdivision'}</h2>
                <p className="sub">{selected.platNumber ? `Plat #${selected.platNumber}` : '—'}</p>
              </div>
              <div className="drawer-block">
                <h4>Subdivision Facts</h4>
                <div className="kv-grid">
                  <div><b>Acreage</b>{fmtAcres(selected.acreage)}</div>
                  <div><b>Plat #</b>{selected.platNumber || '—'}</div>
                </div>
              </div>
              <div className="drawer-actions">
                <button className="btn-ghost" onClick={closeDrawer}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>

      {compareOpen && (
        <div
          className="modal-backdrop show"
          onClick={(e) => { if (e.target === e.currentTarget) setCompareOpen(false); }}
        >
          <div className="modal">
            <button className="modal-close" onClick={() => setCompareOpen(false)}>✕</button>
            <h2>Side-by-side comparison</h2>
            <p className="sub">
              Comparing {compareItems.length} parcel{compareItems.length === 1 ? '' : 's'} from the live PostGIS dataset.
            </p>
            {compareItems.length === 0 ? (
              <p className="empty-note">No parcels selected yet — check a box on a card to add one.</p>
            ) : (
              <table className="compare-table">
                <tbody>
                  <tr>
                    <th>Parcel</th>
                    {compareItems.map((c) => <th key={c.geoId}>{c.name || c.geoId}</th>)}
                  </tr>
                  <tr>
                    <td className="rowlabel">Acreage</td>
                    {compareItems.map((c) => <td key={c.geoId}>{fmtAcres(c.acreage)}</td>)}
                  </tr>
                  <tr>
                    <td className="rowlabel">Zoning</td>
                    {compareItems.map((c) => <td key={c.geoId}>{c.zoning || '—'}</td>)}
                  </tr>
                  <tr>
                    <td className="rowlabel">Prop ID</td>
                    {compareItems.map((c) => <td key={c.geoId}>{c.propId || '—'}</td>)}
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .app {
          display: flex;
          flex-direction: column;
          height: 100vh;
        }

        header.topbar {
          height: 58px;
          flex: 0 0 58px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 18px;
          background: var(--ink);
          border-bottom: 1px solid var(--hair);
        }
        .brand {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .brand .mark {
          width: 26px;
          height: 26px;
          border: 1.4px solid var(--ochre);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--ochre);
          flex: 0 0 26px;
        }
        .brand h1 {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 19px;
          letter-spacing: 0.02em;
          margin: 0;
          color: var(--paper);
        }
        .brand .tag {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding-left: 10px;
          border-left: 1px solid var(--hair);
          margin-left: 2px;
        }
        .topbar-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .locus {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted);
        }
        .demo-pill {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ink);
          background: var(--ochre);
          padding: 4px 9px;
          border-radius: 2px;
          font-weight: 500;
        }

        .body {
          flex: 1;
          display: flex;
          min-height: 0;
          position: relative;
        }

        aside.sidebar {
          width: 378px;
          flex: 0 0 378px;
          background: var(--ink-2);
          border-right: 1px solid var(--hair);
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .sidebar-section {
          padding: 14px 16px;
          border-bottom: 1px solid var(--hair);
          flex-shrink: 0;
        }
        .eyebrow {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--muted);
          margin: 0 0 10px 0;
        }

        .searchrow input {
          width: 100%;
          background: var(--ink);
          border: 1px solid var(--hair);
          color: var(--paper);
          font-family: var(--font-body);
          font-size: 13px;
          padding: 8px 10px;
          border-radius: 3px;
          outline: none;
        }
        .searchrow input::placeholder {
          color: var(--muted);
        }
        .searchrow input:focus {
          border-color: var(--ochre);
        }
        .search-error {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--brick);
          margin: 6px 0 0;
        }

        .layer-toggle {
          display: flex;
          gap: 6px;
          margin-top: 10px;
        }
        .layer-toggle button {
          flex: 1;
          background: var(--ink);
          border: 1px solid var(--hair);
          color: var(--muted);
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.04em;
          padding: 7px 4px;
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.15s ease;
          text-transform: uppercase;
        }
        .layer-toggle button:hover {
          color: var(--paper);
          border-color: var(--moss-bright);
        }
        .layer-toggle button.active {
          background: var(--moss);
          border-color: var(--moss-bright);
          color: var(--paper);
        }

        .filterrow {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          align-items: center;
        }
        .filterrow label {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--muted);
          white-space: nowrap;
        }
        .filterrow select {
          flex: 1;
          background: var(--ink);
          border: 1px solid var(--hair);
          color: var(--paper);
          font-family: var(--font-body);
          font-size: 12px;
          padding: 6px 6px;
          border-radius: 3px;
          outline: none;
        }
        .filterrow input[type='range'] {
          flex: 1;
          accent-color: var(--ochre);
        }
        .slider-value {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--ochre);
          min-width: 26px;
          text-align: right;
        }

        .stats-strip {
          display: flex;
          gap: 0;
          margin-top: 12px;
          border: 1px solid var(--hair);
          border-radius: 3px;
          overflow: hidden;
        }
        .stats-strip div {
          flex: 1;
          padding: 8px 6px;
          text-align: center;
          border-right: 1px solid var(--hair);
        }
        .stats-strip div:last-child {
          border-right: none;
        }
        .stats-strip b {
          display: block;
          font-family: var(--font-display);
          font-size: 18px;
          color: var(--ochre);
          font-weight: 600;
        }
        .stats-strip span {
          font-family: var(--font-mono);
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
        }

        .list {
          flex: 1;
          overflow-y: auto;
          padding: 10px 12px;
          min-height: 0;
        }
        .empty-note {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted);
          padding: 10px;
        }

        .card {
          background: var(--paper);
          color: var(--ink-text);
          border-radius: 4px;
          padding: 11px 12px;
          margin-bottom: 8px;
          cursor: pointer;
          border: 1.5px solid transparent;
          position: relative;
          transition: transform 0.12s ease, border-color 0.12s ease;
        }
        .card:hover {
          transform: translateY(-1px);
          border-color: var(--ochre);
        }
        .card.selected {
          border-color: var(--moss-bright);
          box-shadow: 0 0 0 2px var(--moss-bright) inset;
        }
        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
        }
        .card-top h3 {
          font-family: var(--font-display);
          font-size: 14.5px;
          font-weight: 600;
          margin: 0 0 2px 0;
          line-height: 1.25;
        }
        .card-loc {
          font-family: var(--font-mono);
          font-size: 10px;
          color: #5b6a5c;
          margin: 0;
        }
        .score-chip {
          flex: 0 0 auto;
          width: 20px;
          height: 20px;
          border-radius: 50%;
        }
        .card-meta {
          display: flex;
          gap: 10px;
          margin-top: 8px;
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: #5b6a5c;
          flex-wrap: wrap;
        }
        .card-meta span {
          background: var(--paper-dim);
          padding: 2px 6px;
          border-radius: 2px;
        }
        .grade-label {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 500;
          margin-top: 7px;
          display: inline-block;
        }
        .compare-check {
          position: absolute;
          top: 11px;
          right: 11px;
          transform: scale(1.05);
          accent-color: var(--moss);
        }

        .compare-bar {
          padding: 10px 16px;
          border-top: 1px solid var(--hair);
          background: var(--ink-2);
          display: none;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-shrink: 0;
        }
        .compare-bar.show {
          display: flex;
        }
        .compare-bar span {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted);
        }
        .compare-bar button {
          background: var(--ochre);
          color: var(--ink);
          border: none;
          font-family: var(--font-mono);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 8px 12px;
          border-radius: 3px;
          cursor: pointer;
          font-weight: 600;
        }

        .mapwrap {
          flex: 1;
          position: relative;
          min-width: 0;
        }
        .map-canvas {
          width: 100%;
          height: 100%;
          background: var(--ink);
        }

        .load-error {
          position: absolute;
          top: 12px;
          left: 12px;
          background: var(--brick);
          color: #fff;
          padding: 8px 12px;
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 12px;
          z-index: 500;
        }

        .legend {
          position: absolute;
          left: 14px;
          bottom: 14px;
          background: rgba(20, 28, 23, 0.92);
          border: 1px solid var(--hair);
          border-radius: 4px;
          padding: 10px 12px;
          z-index: 500;
          backdrop-filter: blur(3px);
          max-height: 45vh;
          overflow-y: auto;
          min-width: 170px;
        }
        .legend .eyebrow {
          margin-bottom: 8px;
        }
        .legend-row {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 5px;
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--paper);
        }
        .legend-swatch {
          width: 11px;
          height: 11px;
          border-radius: 2px;
          flex: 0 0 11px;
        }

        .drawer {
          position: absolute;
          top: 0;
          right: 0;
          height: 100%;
          width: 420px;
          background: var(--paper);
          color: var(--ink-text);
          box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
          transform: translateX(100%);
          transition: transform 0.28s ease;
          z-index: 900;
          overflow-y: auto;
        }
        .drawer.open {
          transform: translateX(0);
        }
        .drawer-head {
          padding: 20px 22px 14px;
          border-bottom: 1px dashed #b8ac8a;
          position: relative;
        }
        .drawer-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: 1px solid #b8ac8a;
          background: transparent;
          cursor: pointer;
          color: #5b6a5c;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .drawer-eyebrow {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #7a7156;
          margin: 0 0 6px;
        }
        .drawer-head h2 {
          font-family: var(--font-display);
          font-size: 23px;
          font-weight: 600;
          margin: 0 0 4px;
          line-height: 1.2;
        }
        .drawer-head .sub {
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: #5b6a5c;
          margin: 0;
        }

        .drawer-block {
          padding: 16px 22px;
          border-bottom: 1px solid #ddd0ae;
        }
        .drawer-block h4 {
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #7a7156;
          margin: 0 0 12px;
        }

        .kv-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 14px;
        }
        .kv-grid div {
          font-family: var(--font-mono);
          font-size: 11.5px;
        }
        .kv-grid b {
          display: block;
          font-family: var(--font-body);
          font-size: 10px;
          color: #7a7156;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 2px;
        }

        .drawer-actions {
          padding: 18px 22px;
          display: flex;
          gap: 10px;
        }
        .btn-primary {
          flex: 1;
          background: var(--moss);
          color: #fff;
          border: none;
          padding: 11px 12px;
          border-radius: 3px;
          font-family: var(--font-mono);
          font-size: 11.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          font-weight: 600;
        }
        .btn-ghost {
          background: transparent;
          border: 1px solid #7a7156;
          color: #5b6a5c;
          padding: 11px 12px;
          border-radius: 3px;
          font-family: var(--font-mono);
          font-size: 11.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
        }

        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(10, 14, 11, 0.72);
          z-index: 1500;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 30px;
        }
        .modal-backdrop.show {
          display: flex;
        }
        .modal {
          background: var(--paper);
          color: var(--ink-text);
          border-radius: 6px;
          max-width: 920px;
          width: 100%;
          max-height: 86vh;
          overflow-y: auto;
          padding: 26px 28px;
          position: relative;
        }
        .modal h2 {
          font-family: var(--font-display);
          font-size: 22px;
          margin: 0 0 4px;
        }
        .modal .sub {
          font-family: var(--font-mono);
          font-size: 11px;
          color: #5b6a5c;
          margin-bottom: 18px;
        }
        .modal-close {
          position: absolute;
          top: 18px;
          right: 20px;
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          color: #5b6a5c;
        }
        table.compare-table {
          width: 100%;
          border-collapse: collapse;
          font-family: var(--font-body);
          font-size: 12.5px;
        }
        table.compare-table th,
        table.compare-table td {
          border-bottom: 1px solid #ddd0ae;
          padding: 9px 8px;
          text-align: left;
          vertical-align: top;
        }
        table.compare-table th {
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #7a7156;
          font-weight: 500;
        }
        table.compare-table td.rowlabel {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: #7a7156;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
