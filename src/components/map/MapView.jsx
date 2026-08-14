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
import PolygonAreaControl from "./PolygonAreaControl";
import { usePolygonAreaSelect } from "./usePolygonAreaSelect";

// Layer groups exposed in the layers panel. Each key maps to the actual
// maplibre layer ids that get shown/hidden together.
const LAYER_GROUPS = [
  { key: "cities", label: "Cities", layers: ["cities-fill", "cities-outline"] },
  {
    key: "zoning",
    label: "Zoning",
    layers: ["zoning-fill", "zoning-outline", "zoning-label"],
  },
  {
    key: "parcels",
    label: "Parcels",
    layers: ["parcels-outline", "parcels-fill", "parcels-label"],
  },
  {
    key: "subdivisions",
    label: "Subdivisions",
    layers: ["subdivisions-fill", "subdivisions-outline", "subdivisions-label"],
  },
];

// Adjust this to wherever your zoning_districts data actually sits.
// (Defaulting to Whatcom County, WA to match the existing parcel sync setup.)
const INITIAL_VIEW = { lng: -122.35, lat: 48.75, zoom: 10 };

const DEFAULT_COLOR = "#9aa5b183";
const ZONE_OUTLINE_COLOR = "#e5e5e5"; // dark gray for zoning district borders
const SUBDIVISION_COLOR = "#116bb1";
// Shared hover-highlight accent for zoning/subdivision/city borders —
// same idea as PARCEL_BORDER_HOVER below, kept as one constant since
// these three layers don't have per-layer selected states to juggle.
const LAYER_BORDER_HOVER = "#a20f4a";

// Parcel interaction states — border color changes on hover, and on
// click the border switches to a distinct color plus a translucent fill
// appears (fill stays hidden otherwise, so the base map isn't cluttered
// with a tint on every parcel).
const PARCEL_BORDER_DEFAULT = "#c7e009";
const PARCEL_BORDER_HOVER = "rgb(219, 191, 202)"; // ochre
const PARCEL_BORDER_SELECTED = "#a20f4a"; // brick
const PARCEL_FILL_SELECTED = "#a20f4a";

// Parcels only render once you're zoomed in enough to make individual
// boundaries/labels meaningful — below this it's just noise (and a lot
// of geometry for no visual benefit). Zoning stays visible at every zoom.
const PARCEL_MIN_ZOOM = 13;
// Labels specifically wait even longer than the fill/outline, so text
// doesn't turn into overlapping clutter the moment parcels appear.
const PARCEL_LABEL_MIN_ZOOM = 15;
const ZONE_LABEL_MIN_ZOOM = 10;
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
  {
    onParcelClick,
    onSubdivisionClick,
    onZoningClick,
    onError,
    onFeatureHover,
    setSelected,
    onAreaSelect, // (corners: [lng, lat][4]) => void — fires when a 4-corner area is completed
    onAreaSelectStateChange,
    searchResults, // array of {id, lng, lat, ...} from the search API — used to highlight search results on the map
  },
  ref,
) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  // All area-select map logic (sources/layers/click handling) lives in
  // this hook — see usePolygonAreaSelect.js. This line plus the guard
  // in the click handler below are the entire integration surface.
  const areaSelect = usePolygonAreaSelect({ mapRef, onComplete: onAreaSelect });
  const colorMapRef = useRef(new Map()); // zone_code -> color, assigned once, stable
  // Currently hovered feature's {source, sourceLayer, id} — used to
  // toggle the feature-state "hover" flag that drives border highlight
  // paint across parcels/zoning/subdivisions/cities.
  const hoveredFeatureRef = useRef(null);
  const selectedParcelIdRef = useRef(null);
  const mapLoadedRef = useRef(false);
  // Dedupes the info-card hover callback so we only call up to the
  // parent when the hovered feature actually changes, not on every
  // pixel of mousemove.
  const hoveredInfoKeyRef = useRef(null);
  const selectParcelFnRef = useRef(null);

  const [layerVisibility, setLayerVisibility] = useState(() =>
    Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, true])),
  );

  // While the user is actively drawing a polygon (areaSelect.active),
  // hide every layer group so clicking to place a corner doesn't
  // accidentally trigger a parcel/zoning/subdivision hover or click
  // underneath the crosshair. Once drawing stops, restore each group
  // to whatever visibility it had *before* drawing started — so if the
  // user had, say, zoning turned off in the layers panel, it stays off
  // afterward instead of this blindly turning everything back on.
  useEffect(() => {
    for (const group of LAYER_GROUPS) {
      if (areaSelect.active) {
        applyLayerVisibility(group.key, false);
      } else {
        applyLayerVisibility(group.key, layerVisibility[group.key]);
      }
    }
  }, [areaSelect.active, layerVisibility]);

  // Report drawing state up so an external control (Sidebar) can
  // reflect/trigger it without owning any map logic itself.
  useEffect(() => {
    onAreaSelectStateChange?.({
      active: areaSelect.active,
      pointCount: areaSelect.pointCount,
    });
  }, [areaSelect.active, areaSelect.pointCount, onAreaSelectStateChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("search-results")) return;

    const features = (searchResults?.parcels ?? [])
      .filter((p) => p.centroid)
      .map((p) => ({
        type: "Feature",
        geometry: JSON.parse(p.centroid),
        properties: { id: p.id, name: p.name, acreage: p.acreage },
      }));

    map.getSource("search-results").setData({
      type: "FeatureCollection",
      features,
    });
  }, [searchResults]);

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom = 16) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom });
    },

    selectParcel(id) {
      const map = mapRef.current;
      if (!map || !selectParcelFnRef.current) return;

      const trySelect = () => {
        if (map.isSourceLoaded("parcels")) {
          selectParcelFnRef.current(id);
        } else {
          map.once("idle", trySelect);
        }
      };
      trySelect();
    },

    startAreaSelect() {
      areaSelect.start();
    },
    cancelAreaSelect() {
      areaSelect.cancel();
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
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.on("load", () => {
      // in the same map.on("load", ...) block where other sources are added
      map.addSource("search-results", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "search-results-point",
        type: "circle",
        source: "search-results",
        paint: {
          "circle-radius": 7,
          "circle-color": "#e6161396",
          "circle-stroke-color": "#000",
          "circle-stroke-width": 1.5,
        },
      });

      map.addSource("cities", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/cities/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 24,
        promoteId: "id",
      });

      map.addLayer({
        id: "cities-fill",
        type: "fill",
        source: "cities",
        "source-layer": "cities",
        maxzoom: 15,
        maxzoom: 11,
        paint: {
          "fill-color": "#81056e",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.18,
            0.08,
          ],
        },
      });

      map.addLayer({
        id: "cities-outline",
        type: "line",
        source: "cities",
        "source-layer": "cities",
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            LAYER_BORDER_HOVER,
            "#8f052c",
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            3.5,
            2,
          ],
        },
      });

      map.addSource("zoning", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/zoning/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 12,
        promoteId: "id",
      });

      map.addLayer({
        id: "zoning-fill",
        type: "fill",
        source: "zoning",
        maxzoom: 13.5,
        "source-layer": "zoning_districts",
        paint: {
          "fill-color": DEFAULT_COLOR, // replaced with a per-zone match expr once tiles load
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.6,
            0.45,
          ],
        },
      });

      map.addLayer({
        id: "zoning-outline",
        type: "line",
        source: "zoning",
        "source-layer": "zoning_districts",
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            LAYER_BORDER_HOVER,
            ZONE_OUTLINE_COLOR,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            5,
            3,
          ],
        },
      });

      map.addLayer({
        id: "zoning-label",
        type: "symbol",
        source: "zoning",
        "source-layer": "zoning_districts",
        minzoom: ZONE_LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "zone_desc"],
          "text-size": 12,
          "text-font": ["Klokantech Noto Sans Regular"],
        },
        paint: {
          "text-color": "#2a2a2a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
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
          "text-font": ["Klokantech Noto Sans Regular"],
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
        promoteId: "id",
      });

      map.addLayer({
        id: "subdivisions-fill",
        type: "fill",
        source: "subdivisions",
        "source-layer": "subdivisions",
        minzoom: SUBDIVISION_MIN_ZOOM,
        paint: {
          "fill-color": SUBDIVISION_COLOR,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.3,
            0.15,
          ],
        },
      });

      map.addLayer({
        id: "subdivisions-outline",
        type: "line",
        source: "subdivisions",
        "source-layer": "subdivisions",
        minzoom: SUBDIVISION_MIN_ZOOM,
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            LAYER_BORDER_HOVER,
            SUBDIVISION_COLOR,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            4,
            2.5,
          ],
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
          "text-font": ["Klokantech Noto Sans Regular"],
        },
        paint: {
          "text-color": SUBDIVISION_COLOR,
          "text-halo-color": "",
          "text-halo-width": 1.2,
        },
      });

      map.on("click", (e) => {
        // Area-select is capturing clicks right now — don't also treat
        // this as a parcel/zoning/subdivision click.
        if (areaSelect.activeRef.current) return;

        const layers = [
          "cities-fill",
          "zoning-fill",
          "subdivisions-fill",
          "parcels-fill",
        ];
        const features = map.queryRenderedFeatures(e.point, { layers });

        const topFeature = [...features].sort(
          (a, b) => layers.indexOf(b.layer.id) - layers.indexOf(a.layer.id),
        )[0];

        if (!topFeature) {
          // set this to tell parent to dismiss parcell detaill layout
          setSelected(null);
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

        // --- NEW GEOMETRY BOUNDING BOX LOGIC ---
        // Native bounds calculation from the clicked feature's geometry
        const bounds = new maplibregl.LngLatBounds();

        // MapLibre features can be Polygon or MultiPolygon
        const extractCoords = (coords, isMulti) => {
          if (isMulti) {
            coords.forEach((poly) =>
              poly.forEach((ring) =>
                ring.forEach((coord) => bounds.extend(coord)),
              ),
            );
          } else {
            coords.forEach((ring) =>
              ring.forEach((coord) => bounds.extend(coord)),
            );
          }
        };

        if (topFeature.geometry.type === "Polygon") {
          extractCoords(topFeature.geometry.coordinates, false);
        } else if (topFeature.geometry.type === "MultiPolygon") {
          extractCoords(topFeature.geometry.coordinates, true);
        }

        if (!bounds.isEmpty()) {
          // Max zoom caps so small geometries (like a 500sqft parcel)
          // don't force the camera into maximum magnification.
          const maxZooms = {
            "parcels-fill": 19,
            "subdivisions-fill": 16,
            "zoning-fill": 14,
            "cities-fill": 12,
          };

          map.fitBounds(bounds, {
            padding: 80, // Adds an 80px visual buffer around the polygon
            maxZoom: maxZooms[topFeature.layer.id] || 16,
            duration: 1200,
            essential: true,
          });
        }
        // ---------------------------------------

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
        } else if (topFeature.layer.id === "cities-fill") {
          // Clear parcel highlights when clicking a city space where there are no smaller geometries
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
        }
      });

      map.on(
        "mouseenter",
        ["zoning-fill", "subdivisions-fill", "parcels-fill", "cities-fill"],
        () => {
          map.getCanvas().style.cursor = "pointer";
        },
      );
      map.on(
        "mouseleave",
        ["zoning-fill", "subdivisions-fill", "parcels-fill", "cities-fill"],
        () => {
          map.getCanvas().style.cursor = "";
        },
      );

      // Unified hover handling — drives both the border highlight
      // (feature-state "hover", same mechanism the parcel layer already
      // used) and the info card, for all four interactive layers.
      // Priority mirrors the click handler: most specific feature
      // (parcel) wins over broader ones (subdivision, zoning, city)
      // when they stack on top of each other.
      const HOVER_LAYERS = [
        "parcels-fill",
        "subdivisions-fill",
        "zoning-fill",
        "cities-fill",
      ];
      // Maps a fill layer id to the source + source-layer its features
      // need for setFeatureState — each source below is registered with
      // promoteId: "id" so state keys off that stable id.
      const HOVER_SOURCE_INFO = {
        "parcels-fill": { source: "parcels", sourceLayer: "parcels" },
        "subdivisions-fill": {
          source: "subdivisions",
          sourceLayer: "subdivisions",
        },
        "zoning-fill": { source: "zoning", sourceLayer: "zoning_districts" },
        "cities-fill": { source: "cities", sourceLayer: "cities" },
      };

      const clearHoverBorder = () => {
        if (!hoveredFeatureRef.current) return;
        map.setFeatureState(hoveredFeatureRef.current, { hover: false });
        hoveredFeatureRef.current = null;
      };

      map.on("mousemove", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: HOVER_LAYERS,
        });
        const topFeature = [...features].sort(
          (a, b) =>
            HOVER_LAYERS.indexOf(a.layer.id) - HOVER_LAYERS.indexOf(b.layer.id),
        )[0];

        if (!topFeature) {
          clearHoverBorder();
          if (hoveredInfoKeyRef.current !== null) {
            hoveredInfoKeyRef.current = null;
            onFeatureHover?.(null);
          }
          return;
        }

        const key = `${topFeature.layer.id}:${topFeature.id ?? JSON.stringify(topFeature.properties)}`;
        if (hoveredInfoKeyRef.current === key) return;
        hoveredInfoKeyRef.current = key;

        // Border highlight — swap feature-state hover off the
        // previously hovered feature and onto this one.
        clearHoverBorder();
        const srcInfo = HOVER_SOURCE_INFO[topFeature.layer.id];
        if (srcInfo && topFeature.id != null) {
          const target = {
            source: srcInfo.source,
            sourceLayer: srcInfo.sourceLayer,
            id: topFeature.id,
          };
          map.setFeatureState(target, { hover: true });
          hoveredFeatureRef.current = target;
        }

        // Info card data.
        if (!onFeatureHover) return;
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
        clearHoverBorder();
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

    const clearSelection = () => {
      if (selectedParcelIdRef.current === null) return;
      map.setFeatureState(
        {
          source: "parcels",
          sourceLayer: "parcels",
          id: selectedParcelIdRef.current,
        },
        { selected: false },
      );
      selectedParcelIdRef.current = null;
    };

    const selectParcelById = (id) => {
      if (id === selectedParcelIdRef.current) return;
      clearSelection();
      map.setFeatureState(
        { source: "parcels", sourceLayer: "parcels", id },
        { selected: true },
      );
      selectedParcelIdRef.current = id;
    };

    selectParcelFnRef.current = selectParcelById; // <-- filled here

    map.on("error", (e) => {
      // Surfaces tile/network errors (e.g. DB not reachable) in the UI
      // instead of failing silently.
      if (e?.error?.message) onError?.(e.error.message);
    });

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
      <PolygonAreaControl {...areaSelect} />
    </div>
  );
});

export default MapView;
export { DEFAULT_COLOR, SUBDIVISION_COLOR };
