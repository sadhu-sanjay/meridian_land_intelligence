"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Self-contained "select a 4-corner area" interaction for MapView.
//
// Owns everything the feature needs: its own maplibre source/layers for
// the in-progress points/outline/fill, the click handler that collects
// corners while active, and the point state itself. MapView just calls
// this hook and renders <PolygonAreaControl /> for the button — it never
// touches a source, layer, or click handler for this feature directly.
//
// Usage in MapView:
//   const areaSelect = usePolygonAreaSelect({ mapRef, onComplete });
//   <PolygonAreaControl {...areaSelect} />
//   // and, inside the existing map click handler, one guard line:
//   if (areaSelect.activeRef.current) return;
//
// onComplete(coords) fires once 4 corners are placed, with coords as an
// array of 4 [lng, lat] pairs in click order (not yet closed).

const SRC_FILL = "area-select-fill";
const SRC_LINE = "area-select-line";
const SRC_POINTS = "area-select-points";

const emptyFC = () => ({ type: "FeatureCollection", features: [] });

export function usePolygonAreaSelect({ mapRef, onComplete }) {
  const [active, setActive] = useState(false);
  const [pointCount, setPointCount] = useState(0);

  // Refs mirror the state above so the click handler (registered once,
  // in a `[]`-deps effect) always sees the current value instead of a
  // stale closure. `activeRef` is also what MapView's own click handler
  // checks to know "don't treat this click as a parcel/zoning click".
  const activeRef = useRef(false);
  const pointsRef = useRef([]);
  const readyRef = useRef(false); // sources/layers exist on the map yet?
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const render = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const points = pointsRef.current;
    const ring = points.length === 4 ? [...points, points[0]] : points;

    map.getSource(SRC_POINTS)?.setData({
      type: "FeatureCollection",
      features: points.map((coordinates) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates },
      })),
    });

    map.getSource(SRC_LINE)?.setData(
      points.length >= 2
        ? {
            type: "FeatureCollection",
            features: [
              { type: "Feature", geometry: { type: "LineString", coordinates: ring } },
            ],
          }
        : emptyFC(),
    );

    map.getSource(SRC_FILL)?.setData(
      points.length === 4
        ? {
            type: "FeatureCollection",
            features: [
              { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } },
            ],
          }
        : emptyFC(),
    );
  }, [mapRef]);

  const reset = useCallback(() => {
    pointsRef.current = [];
    setPointCount(0);
    render();
  }, [render]);

  // Turn the tool on: clears any previous shape and starts listening
  // for the next 4 clicks.
  const start = useCallback(() => {
    reset();
    activeRef.current = true;
    setActive(true);
  }, [reset]);

  // Turn it off without completing — clears the in-progress shape.
  const cancel = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    reset();
  }, [reset]);

  // Remove the last placed corner (handy for a misclick on point 3/4).
  const undo = useCallback(() => {
    pointsRef.current = pointsRef.current.slice(0, -1);
    setPointCount(pointsRef.current.length);
    render();
  }, [render]);

  useEffect(() => {
  let cancelled = false;
  let detachClick = null;

  const trySetup = () => {
    if (cancelled) return; // stale poll from a previous (cleaned-up) mount — do nothing

    const map = mapRef.current;
    if (!map) {
      requestAnimationFrame(trySetup);
      return;
    }

    const addLayersAndSources = () => {
      if (map.getSource(SRC_FILL)) return;

      map.addSource(SRC_FILL, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: SRC_FILL,
        type: "fill",
        source: SRC_FILL,
        paint: { "fill-color": "#c9922f", "fill-opacity": 0.15 },
      });

      map.addSource(SRC_LINE, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: SRC_LINE,
        type: "line",
        source: SRC_LINE,
        paint: {
          "line-color": "#c9922f",
          "line-width": 2,
          "line-dasharray": [2, 1],
        },
      });

      map.addSource(SRC_POINTS, { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: SRC_POINTS,
        type: "circle",
        source: SRC_POINTS,
        paint: {
          "circle-radius": 5,
          "circle-color": "#c9922f",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#1e2a22",
        },
      });

      readyRef.current = true;
    };

    if (map.isStyleLoaded()) addLayersAndSources();
    else map.once("load", addLayersAndSources);

    const handleClick = (e) => {
      if (!activeRef.current) return;

      const next = [...pointsRef.current, [e.lngLat.lng, e.lngLat.lat]];
      pointsRef.current = next;
      setPointCount(next.length);
      render();

      if (next.length === 4) {
        activeRef.current = false;
        setActive(false);
        onCompleteRef.current?.(next);
      }
    };

    map.on("click", handleClick);
    detachClick = () => map.off("click", handleClick);
  };

  trySetup();

  return () => {
    cancelled = true;
    detachClick?.();
  };
}, [mapRef, render]);
  
  return { active, activeRef, pointCount, start, cancel, undo };
}
