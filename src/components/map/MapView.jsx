"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import maplibregl from "maplibre-gl";
import LayersControl from "./LayersControl";

// Layer groups exposed in the layers panel. Each key maps to the actual
// maplibre layer ids that get shown/hidden together.
const LAYER_GROUPS = [
  {
    key: "cities",
    label: "Cities",
    layers: ["cities-fill", "cities-outline"],
    visible: true,
  },
  {
    key: "zoning",
    label: "Zoning",
    layers: ["zoning-fill", "zoning-outline", "zoning-label"],
    visible: true,
  },
  {
    key: "parcels",
    label: "Parcels",
    layers: ["parcels-outline", "parcels-fill", "parcels-label"],
    visible: true,
  },
  {
    key: "subdivisions",
    label: "Subdivisions",
    layers: ["subdivisions-fill", "subdivisions-outline", "subdivisions-label"],
    visible: true,
  },
];

// Adjust this to wherever your zoning_districts data actually sits.
// (Defaulting to Whatcom County, WA to match the existing parcel sync setup.)
const INITIAL_VIEW = { lng: -122.35, lat: 48.75, zoom: 10 };

const DEFAULT_COLOR = "#9AA5B1";
const SUBDIVISION_COLOR = "#116bb1";

// Parcel interaction states — border color changes on hover, and on
// click the border switches to a distinct color plus a translucent fill
// appears (fill stays hidden otherwise, so the base map isn't cluttered
// with a tint on every parcel).
const PARCEL_BORDER_DEFAULT = "#c7e009";
const PARCEL_BORDER_HOVER = "#a20f4a"; // ochre
const PARCEL_BORDER_SELECTED = "#a20f4a"; // brick
const PARCEL_FILL_SELECTED = "#a20f4a";

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

// Owns the maplibre instance, all sources/layers, and map-level
// interactions (click, hover, zone coloring). Reports selections up via
// callback props rather than owning "selected" state itself — page.js
// still decides what a selection means and how it's displayed.
//
// Exposes flyTo(lng, lat, zoom) via ref for the parent to call after a
// search selection, since the map instance itself no longer lives in
// page.js.
const MapView = forwardRef(function MapView(
  { onParcelClick, onSubdivisionClick, onZoningClick, onError, onFeatureHover },
  ref,
) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const colorMapRef = useRef(new Map()); // zone_code -> color, assigned once, stable
  const hoveredParcelIdRef = useRef(null);
  const selectedParcelIdRef = useRef(null);
  const mapLoadedRef = useRef(false);
  // Dedupes the info-card hover callback so we only call up to the
  // parent when the hovered feature actually changes, not on every
  // pixel of mousemove.
  const hoveredInfoKeyRef = useRef(null);

  const [layerVisibility, setLayerVisibility] = useState(() =>
    Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, g.visible])),
  );

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom = 16) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom });
    },
  }));

  // Applies a group's on/off state to its underlying maplibre layers.
  // Safe to call before the map/layers exist (e.g. from initial state
  // effects) — just does nothing until they're there.
  const applyLayerVisibility = (groupKey, visible) => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const group = LAYER_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;
    for (const layerId of group.layers) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(
          layerId,
          "visibility",
          visible ? "visible" : "none",
        );
      }
    }
  };

  const toggleLayer = (groupKey) => {
    setLayerVisibility((prev) => {
      const next = { ...prev, [groupKey]: !prev[groupKey] };
      applyLayerVisibility(groupKey, next[groupKey]);
      return next;
    });
  };

  // Looks at whatever zoning features are currently loaded on screen and
  // assigns any new zone_codes a color (existing ones keep theirs), then
  // pushes the resulting match expression into the layer paint.
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

  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          basemap: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution:
              "Imagery © Esri, Maxar, Earthstar Geographics — ArcGIS Online World Imagery",
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
      map.addSource("cities", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/cities/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 24,
      });

      map.addLayer({
        id: "cities-fill",
        type: "fill",
        source: "cities",
        "source-layer": "cities",
        paint: {
          "fill-color": "#81056e",
          "fill-opacity": 0.08,
        },
      });

      map.addLayer({
        id: "cities-outline",
        type: "line",
        source: "cities",
        "source-layer": "cities",
        paint: {
          "line-color": "#8f052c",
          "line-width": 2,
        },
      });

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
        id: "parcels-outline",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            PARCEL_BORDER_SELECTED,
            ["boolean", ["feature-state", "hover"], false],
            PARCEL_BORDER_HOVER,
            PARCEL_BORDER_DEFAULT,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            4.5,
            ["boolean", ["feature-state", "hover"], false],
            5,
            2,
          ],
        },
      });

      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        paint: {
          // Fill only appears once a parcel is selected — this layer
          // exists mainly so clicks/hovers have a polygon to hit-test
          // against (a line layer alone isn't reliably clickable).
          "fill-color": PARCEL_FILL_SELECTED,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.2,
            0,
          ],
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

        if (!topFeature) {
          // Clicked empty space — deselect whatever parcel was highlighted.
          if (selectedParcelIdRef.current !== null) {
            map.setFeatureState(
              {
                source: "parcels",
                sourceLayer: "parcels",
                id: selectedParcelIdRef.current,
              },
              { selected: false },
            );
            selectedParcelIdRef.current = null;
          }
          return;
        }

        if (topFeature.layer.id === "parcels-fill") {
          if (
            selectedParcelIdRef.current !== null &&
            selectedParcelIdRef.current !== topFeature.id
          ) {
            map.setFeatureState(
              {
                source: "parcels",
                sourceLayer: "parcels",
                id: selectedParcelIdRef.current,
              },
              { selected: false },
            );
          }
          selectedParcelIdRef.current = topFeature.id;
          map.setFeatureState(
            { source: "parcels", sourceLayer: "parcels", id: topFeature.id },
            { selected: true },
          );
          onParcelClick?.(topFeature.properties.id, e.lngLat);
        } else if (topFeature.layer.id === "subdivisions-fill") {
          // Selection moved to a different feature type — clear any
          // highlighted parcel so the border doesn't stay stuck.
          if (selectedParcelIdRef.current !== null) {
            map.setFeatureState(
              {
                source: "parcels",
                sourceLayer: "parcels",
                id: selectedParcelIdRef.current,
              },
              { selected: false },
            );
            selectedParcelIdRef.current = null;
          }
          onSubdivisionClick?.({
            name: topFeature.properties.name,
            subdivisionName: topFeature.properties.subdivision_name,
            platNumber: topFeature.properties.plat_number,
            acreage: topFeature.properties.acreage,
          });
        } else if (topFeature.layer.id === "zoning-fill") {
          if (selectedParcelIdRef.current !== null) {
            map.setFeatureState(
              {
                source: "parcels",
                sourceLayer: "parcels",
                id: selectedParcelIdRef.current,
              },
              { selected: false },
            );
            selectedParcelIdRef.current = null;
          }
          const zone_code = topFeature.properties.zone_code;
          onZoningClick?.({
            zone_code,
            zone_desc: topFeature.properties.zone_desc,
            acres: topFeature.properties.acres,
            color: colorMapRef.current.get(zone_code) || DEFAULT_COLOR,
          });
        }
      });

      // Hover border — tracked separately from click/selection via its
      // own feature-state flag so the two can be styled independently.
      map.on("mousemove", "parcels-fill", (e) => {
        if (!e.features?.length) return;
        const id = e.features[0].id;
        if (hoveredParcelIdRef.current === id) return;

        if (hoveredParcelIdRef.current !== null) {
          map.setFeatureState(
            {
              source: "parcels",
              sourceLayer: "parcels",
              id: hoveredParcelIdRef.current,
            },
            { hover: false },
          );
        }
        hoveredParcelIdRef.current = id;
        map.setFeatureState(
          { source: "parcels", sourceLayer: "parcels", id },
          { hover: true },
        );
      });

      map.on("mouseleave", "parcels-fill", () => {
        if (hoveredParcelIdRef.current === null) return;
        map.setFeatureState(
          {
            source: "parcels",
            sourceLayer: "parcels",
            id: hoveredParcelIdRef.current,
          },
          { hover: false },
        );
        hoveredParcelIdRef.current = null;
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

      // Unified hover reporting for the info card — independent of the
      // parcel-specific feature-state hover border above. Priority
      // mirrors the click handler: most specific feature (parcel) wins
      // over broader ones (subdivision, zoning, city) when they stack.
      const HOVER_LAYERS = [
        "parcels-fill",
        "subdivisions-fill",
        "zoning-fill",
        "cities-fill",
      ];
      map.on("mousemove", (e) => {
        if (!onFeatureHover) return;
        const features = map.queryRenderedFeatures(e.point, {
          layers: HOVER_LAYERS,
        });
        const topFeature = [...features].sort(
          (a, b) =>
            HOVER_LAYERS.indexOf(a.layer.id) - HOVER_LAYERS.indexOf(b.layer.id),
        )[0];

        if (!topFeature) {
          if (hoveredInfoKeyRef.current !== null) {
            hoveredInfoKeyRef.current = null;
            onFeatureHover(null);
          }
          return;
        }

        const key = `${topFeature.layer.id}:${topFeature.id ?? JSON.stringify(topFeature.properties)}`;
        if (hoveredInfoKeyRef.current === key) return;
        hoveredInfoKeyRef.current = key;

        const p = topFeature.properties;
        if (topFeature.layer.id === "parcels-fill") {
          onFeatureHover({
            kind: "parcel",
            id: p.id,
            propId: p.prop_id,
            name: p.name,
            zoning: p.zoning,
            acreage: p.acreage,
          });
        } else if (topFeature.layer.id === "subdivisions-fill") {
          onFeatureHover({
            kind: "subdivision",
            name: p.name,
            subdivisionName: p.subdivision_name,
            acreage: p.acreage,
          });
        } else if (topFeature.layer.id === "zoning-fill") {
          onFeatureHover({
            kind: "zoning",
            zone_code: p.zone_code,
            zone_desc: p.zone_desc,
          });
        } else if (topFeature.layer.id === "cities-fill") {
          onFeatureHover({
            kind: "city",
            city_name: p.city_name,
            city_type: p.city_type,
          });
        }
      });

      map.getCanvas().addEventListener("mouseleave", () => {
        if (hoveredInfoKeyRef.current !== null) {
          hoveredInfoKeyRef.current = null;
          onFeatureHover?.(null);
        }
      });

      mapLoadedRef.current = true;
      for (const group of LAYER_GROUPS) {
        applyLayerVisibility(group.key, layerVisibility[group.key]);
      }
    });

    map.on("error", (e) => {
      // Surfaces tile/network errors (e.g. DB not reachable) in the UI
      // instead of failing silently.
      if (e?.error?.message) onError?.(e.error.message);
    });

    // map.on("idle", refreshZoneColors);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />
      <LayersControl
        groups={LAYER_GROUPS}
        visibility={layerVisibility}
        onToggle={toggleLayer}
      />
    </div>
  );
});

export default MapView;
export { DEFAULT_COLOR, SUBDIVISION_COLOR };
