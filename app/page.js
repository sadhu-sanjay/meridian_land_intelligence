'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

// Adjust this to wherever your zoning_districts data actually sits.
// (Defaulting to Whatcom County, WA to match the existing parcel sync setup.)
const INITIAL_VIEW = { lng: -122.35, lat: 48.75, zoom: 10 };

const DEFAULT_COLOR = '#9AA5B1';

// Parcels only render once you're zoomed in enough to make individual
// boundaries/labels meaningful — below this it's just noise (and a lot
// of geometry for no visual benefit). Zoning stays visible at every zoom.
const PARCEL_MIN_ZOOM = 13;
// Labels specifically wait even longer than the fill/outline, so text
// doesn't turn into overlapping clutter the moment parcels appear.
const PARCEL_LABEL_MIN_ZOOM = 15;
const ZONE_LABEL_MIN_ZOOM = 11;

// Deterministic, maximally-spread color per index using the golden-angle
// hue rotation — the Nth zone_code always gets the same color, and
// neighboring indices land far apart on the color wheel so adjacent
// legend entries stay visually distinct even with 20+ zones.
function colorForIndex(i) {
  const hue = (i * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 65%, 55%)`;
}

export default function Page() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const colorMapRef = useRef(new Map()); // zone_code -> color, assigned once, stable
  const [selected, setSelected] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [legend, setLegend] = useState([]); // [{ code, desc, color }]

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
          basemap: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
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
          'fill-opacity': 0.45,
        },
      });

      map.addLayer({
        id: 'zoning-outline',
        type: 'line',
        source: 'zoning',
        'source-layer': 'zoning_districts',
        paint: {
          'line-color': DEFAULT_COLOR,
          'line-width': 1,
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
          'text-color': '#2a2a2a',
          'text-halo-color': '#ffffff',
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
          'fill-color': '#3aa9ff',
          'fill-opacity': 0.12,
        },
      });

      map.addLayer({
        id: 'parcels-outline',
        type: 'line',
        source: 'parcels',
        'source-layer': 'parcels',
        minzoom: PARCEL_MIN_ZOOM,
        paint: {
          'line-color': '#1c6fb8',
          'line-width': 1,
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
          'text-color': '#0b3d66',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      });

      map.on('click', 'parcels-fill', (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        setSelected({
          propId: feature.properties.prop_id,
          geoId: feature.properties.geo_id,
          name: feature.properties.name,
          zoning: feature.properties.zoning,
          acreage: feature.properties.acreage,
          lngLat: e.lngLat,
        });
      });

      map.on('mouseenter', 'parcels-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'parcels-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      // Re-derive the zone_code -> color legend whenever new tiles have
      // finished loading (pan/zoom reveals new zones, initial load, etc).
      map.on('idle', refreshZoneColors);

      map.on('click', 'zoning-fill', (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        setSelected({
          zone_code: feature.properties.zone_code,
          zone_desc: feature.properties.zone_desc,
          acres: feature.properties.acres,
          lngLat: e.lngLat,
        });
      });

      map.on('mouseenter', 'zoning-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'zoning-fill', () => {
        map.getCanvas().style.cursor = '';
      });
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

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100vw' }}>
      <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          background: 'white',
          padding: '10px 14px',
          borderRadius: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          fontSize: 13,
          maxWidth: 220,
        }}
      >
        <strong>Zoning Districts</strong>
        <div style={{ color: '#666', marginTop: 4 }}>
          Vector tiles served live from PostGIS. Click a parcel zone for details.
        </div>
        {loadError && (
          <div style={{ color: '#c0392b', marginTop: 6 }}>Error: {loadError}</div>
        )}
      </div>

      {legend.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 56,
            background: 'white',
            padding: '10px 14px',
            borderRadius: 8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            fontSize: 12,
            maxHeight: '70vh',
            overflowY: 'auto',
            minWidth: 160,
          }}
        >
          <strong style={{ fontSize: 13 }}>Zones</strong>
          <div style={{ marginTop: 6 }}>
            {legend.map(({ code, color, desc }) => (
              <div
                key={code}
                style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: color,
                    display: 'inline-block',
                    marginRight: 6,
                    flexShrink: 0,
                  }}
                />
                <span>
                  <strong>{code}</strong>
                  {desc ? ` — ${desc}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && selected.propId === undefined && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 12,
            background: 'white',
            padding: '12px 16px',
            borderRadius: 8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            fontSize: 13,
            minWidth: 200,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: colorMapRef.current.get(selected.zone_code) || DEFAULT_COLOR,
                  display: 'inline-block',
                  marginRight: 6,
                }}
              />
              <strong>{selected.zone_code || 'Unknown zone'}</strong>
            </span>
            <span
              onClick={() => setSelected(null)}
              style={{ cursor: 'pointer', color: '#999', marginLeft: 12 }}
            >
              ✕
            </span>
          </div>
          <div style={{ marginTop: 4 }}>{selected.zone_desc}</div>
          {selected.acres != null && (
            <div style={{ marginTop: 4, color: '#666' }}>
              {Number(selected.acres).toFixed(2)} acres
            </div>
          )}
        </div>
      )}

      {selected && selected.propId !== undefined && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 12,
            background: 'white',
            padding: '12px 16px',
            borderRadius: 8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            fontSize: 13,
            minWidth: 200,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Parcel {selected.propId || 'Unknown'}</strong>
            <span
              onClick={() => setSelected(null)}
              style={{ cursor: 'pointer', color: '#999', marginLeft: 12 }}
            >
              ✕
            </span>
          </div>
          {selected.name && <div style={{ marginTop: 4 }}>{selected.name}</div>}
          {selected.zoning && (
            <div style={{ marginTop: 4, color: '#666' }}>Zoning: {selected.zoning}</div>
          )}
          {selected.acreage != null && (
            <div style={{ marginTop: 4, color: '#666' }}>
              {Number(selected.acreage).toFixed(2)} acres
            </div>
          )}
          {selected.geoId && (
            <div style={{ marginTop: 4, color: '#999', fontSize: 11 }}>
              geo_id: {selected.geoId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
