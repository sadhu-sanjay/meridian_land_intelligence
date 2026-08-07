"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {ParcelDetailDrawer} from "@/components/parcel_detail";

// Adjust this to wherever your zoning_districts data actually sits.
// (Defaulting to Whatcom County, WA to match the existing parcel sync setup.)
const INITIAL_VIEW = { lng: -122.35, lat: 48.75, zoom: 10 };

const DEFAULT_COLOR = "#9AA5B1";
const SUBDIVISION_COLOR = "#022da5"; // placeholder magenta — swap for your exact hex if you have one

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
const SUBDIVISION_MIN_ZOOM = 11;
const SUBDIVISION_LABEL_MIN_ZOOM = 13;

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
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Looks at whatever zoning features are currently loaded on screen and
  // assigns any new zone_codes a color (existing ones keep theirs), then
  // pushes the resulting match expression into the layer paint. This still
  // drives the on-map fill/outline colors — only the legend list UI that
  // used to read from this has been removed.
  const refreshZoneColors = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer("zoning-fill")) return;

    const features = map.querySourceFeatures("zoning", {
      sourceLayer: "zoning_districts",
    });

    const codes = new Set();
    for (const f of features) {
      const code = f.properties?.zone_code;
      if (code) codes.add(code);
    }

    const colorMap = colorMapRef.current;
    let added = false;
    for (const code of [...codes].sort()) {
      if (!colorMap.has(code)) {
        colorMap.set(code, colorForIndex(colorMap.size));
        added = true;
      }
    }
    if (!added) return;

    const matchExpr = ["match", ["get", "zone_code"]];
    for (const [code, color] of colorMap.entries()) {
      matchExpr.push(code, color);
    }
    matchExpr.push(DEFAULT_COLOR);

    map.setPaintProperty("zoning-fill", "fill-color", matchExpr);
    map.setPaintProperty("zoning-outline", "line-color", matchExpr);
  };

  // Fetches the aggregated parcel record (zoning + acreage + subdivision +
  // value + grade, all resolved server-side) for the clicked parcel id.
  const loadParcelDetail = async (id, lngLat) => {
    setDetailLoading(true);
    setSelected({ kind: "parcel", id, lngLat }); // show the card immediately, filled in once data lands
    try {
      const res = await fetch(`/api/parcels/${id}/detail`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setSelected({ kind: "parcel", lngLat, ...data });
    } catch (err) {
      setSelected({ kind: "parcel", id, lngLat, error: err.message });
    } finally {
      setDetailLoading(false);
    }
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
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          basemap: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
      },
      center: [INITIAL_VIEW.lng, INITIAL_VIEW.lat],
      zoom: INITIAL_VIEW.zoom,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("zoning", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/zoning/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 12,
      });

      map.addLayer({
        id: "zoning-fill",
        type: "fill",
        source: "zoning",
        maxzoom: 13.5,
        "source-layer": "zoning_districts",
        paint: {
          "fill-color": DEFAULT_COLOR, // replaced with a per-zone match expr once tiles load
          "fill-opacity": 0.45,
        },
      });

      map.addLayer({
        id: "zoning-outline",
        type: "line",
        source: "zoning",
        "source-layer": "zoning_districts",
        paint: {
          "line-color": DEFAULT_COLOR,
          "line-width": 1,
        },
      });

      map.addLayer({
        id: "zoning-label",
        type: "symbol",
        source: "zoning",
        "source-layer": "zoning_districts",
        minzoom: ZONE_LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "zone_code"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": "#2a2a2a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2,
        },
      });

      // --- Parcels ---
      map.addSource("parcels", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/parcels/{z}/{x}/{y}.pbf`],
        minzoom: PARCEL_MIN_ZOOM,
        maxzoom: 22,
        promoteId: "id",
      });

      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        paint: {
          "fill-color": "#3aa9ff",
          "fill-opacity": 0.12,
        },
      });

      map.addLayer({
        id: "parcels-outline",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        paint: {
          "line-color": "#1c6fb8",
          "line-width": 1,
        },
      });

      map.addLayer({
        id: "parcels-label",
        type: "symbol",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "prop_id"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": "#0b3d66",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2,
        },
      });

      // --- Subdivisions ---
      map.addSource("subdivisions", {
        type: "vector",
        tiles: [
          `${window.location.origin}/api/tiles/subdivisions/{z}/{x}/{y}.pbf`,
        ],
        minzoom: SUBDIVISION_MIN_ZOOM,
        maxzoom: 16,
      });

      map.addLayer({
        id: "subdivisions-fill",
        type: "fill",
        source: "subdivisions",
        "source-layer": "subdivisions",
        minzoom: SUBDIVISION_MIN_ZOOM,
        paint: {
          "fill-color": SUBDIVISION_COLOR,
          "fill-opacity": 0.15,
        },
      });

      map.addLayer({
        id: "subdivisions-outline",
        type: "line",
        source: "subdivisions",
        "source-layer": "subdivisions",
        minzoom: SUBDIVISION_MIN_ZOOM,
        paint: {
          "line-color": SUBDIVISION_COLOR,
          "line-width": 2.5,
        },
      });

      map.addLayer({
        id: "subdivisions-label",
        type: "symbol",
        source: "subdivisions",
        "source-layer": "subdivisions",
        minzoom: SUBDIVISION_LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "subdivision_name"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": SUBDIVISION_COLOR,
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2,
        },
      });

      map.on("click", (e) => {
        const layers = ["zoning-fill", "subdivisions-fill", "parcels-fill"];
        const features = map.queryRenderedFeatures(e.point, { layers });

        const topFeature = [...features].sort(
          (a, b) => layers.indexOf(b.layer.id) - layers.indexOf(a.layer.id),
        )[0];

        if (!topFeature) return;

        if (topFeature.layer.id === "parcels-fill") {
          loadParcelDetail(topFeature.properties.id, e.lngLat);
        } else if (topFeature.layer.id === "subdivisions-fill") {
          setSelected({
            kind: "subdivision",
            name: topFeature.properties.name,
            subdivisionName: topFeature.properties.subdivision_name,
            platNumber: topFeature.properties.plat_number,
            acreage: topFeature.properties.acreage,
          });
        } else if (topFeature.layer.id === "zoning-fill") {
          setSelected({
            kind: "zoning",
            zone_code: topFeature.properties.zone_code,
            zone_desc: topFeature.properties.zone_desc,
            acres: topFeature.properties.acres,
          });
        }
      });

      map.on(
        "mouseenter",
        ["zoning-fill", "subdivisions-fill", "parcels-fill"],
        () => {
          map.getCanvas().style.cursor = "pointer";
        },
      );
      map.on(
        "mouseleave",
        ["zoning-fill", "subdivisions-fill", "parcels-fill"],
        () => {
          map.getCanvas().style.cursor = "";
        },
      );
    });

    map.on("error", (e) => {
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
    <div style={{ position: "relative", height: "100vh", width: "100vw" }}>
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: "white",
          padding: "10px 14px",
          borderRadius: 8,
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
          fontSize: 13,
          maxWidth: 220,
        }}
      >
        <strong>Zoning Districts</strong>
        <div style={{ color: "#666", marginTop: 4 }}>
          Vector tiles served live from PostGIS. Click a parcel zone for
          details.
        </div>
        {loadError && (
          <div style={{ color: "#c0392b", marginTop: 6 }}>
            Error: {loadError}
          </div>
        )}
      </div>

      {selected && selected.kind === "zoning" && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 12,
            background: "white",
            padding: "12px 16px",
            borderRadius: 8,
            boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
            fontSize: 13,
            minWidth: 200,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ display: "flex", alignItems: "center" }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background:
                    colorMapRef.current.get(selected.zone_code) ||
                    DEFAULT_COLOR,
                  display: "inline-block",
                  marginRight: 6,
                }}
              />
              <strong>{selected.zone_code || "Unknown zone"}</strong>
            </span>
            <span
              onClick={() => setSelected(null)}
              style={{ cursor: "pointer", color: "#999", marginLeft: 12 }}
            >
              ✕
            </span>
          </div>
        </div>
      )}

      <ParcelDetailDrawer
        selected={selected}
        detailLoading={detailLoading}
        onClose={() => setSelected(null)}
      />

      {selected && selected.kind === "subdivision" && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 12,
            background: "white",
            padding: "12px 16px",
            borderRadius: 8,
            boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
            fontSize: 13,
            minWidth: 200,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ display: "flex", alignItems: "center" }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: SUBDIVISION_COLOR,
                  display: "inline-block",
                  marginRight: 6,
                }}
              />
              <strong>
                {selected.subdivisionName ||
                  selected.name ||
                  "Unknown subdivision"}
              </strong>
            </span>
            <span
              onClick={() => setSelected(null)}
              style={{ cursor: "pointer", color: "#999", marginLeft: 12 }}
            >
              ✕
            </span>
          </div>
          {selected.acreage != null && (
            <div style={{ marginTop: 4, color: "#666" }}>
              {Number(selected.acreage).toFixed(2)} acres
            </div>
          )}
          {selected.platNumber && (
            <div style={{ marginTop: 4, color: "#999", fontSize: 11 }}>
              plat #: {selected.platNumber}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
