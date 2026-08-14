// Planar approximation, fine for parcel-scale areas (a few km across).
// Converts lng/lat degrees to meters using the selection's average
// latitude, then applies the shoelace formula.
export function computeAreaStats(corners) {
  if (!corners || corners.length < 3) return null;

  const avgLat = corners.reduce((sum, [, lat]) => sum + lat, 0) / corners.length;
  const latRad = (avgLat * Math.PI) / 180;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(latRad);

  const projected = corners.map(([lng, lat]) => [
    lng * metersPerDegLng,
    lat * metersPerDegLat,
  ]);

  let area = 0;
  for (let i = 0; i < projected.length; i++) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[(i + 1) % projected.length];
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area) / 2; // square meters

  return {
    sqft: Math.round(area * 10.7639),
    acres: Math.round((area / 4046.86) * 100) / 100,
    centerLng: corners.reduce((sum, [lng]) => sum + lng, 0) / corners.length,
    centerLat: corners.reduce((sum, [, lat]) => sum + lat, 0) / corners.length,
  };
}

// Projects the 4 lng/lat corners into a small SVG viewBox so the shape
// itself can be drawn as a thumbnail, preserving relative proportions
// (not true geographic scale — just "does this look like what I drew").
export function cornersToThumbnailPoints(corners, viewSize = 56, padding = 6) {
  if (!corners || corners.length < 3) return null;

  const lngs = corners.map(([lng]) => lng);
  const lats = corners.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const spanLng = maxLng - minLng || 1;
  const spanLat = maxLat - minLat || 1;
  const drawable = viewSize - padding * 2;

  // Uniform scale on both axes (not stretched independently), so a
  // roughly-square drawn area still looks roughly square in the thumbnail.
  const scale = drawable / Math.max(spanLng, spanLat);
  const offsetX = padding + (drawable - spanLng * scale) / 2;
  const offsetY = padding + (drawable - spanLat * scale) / 2;

  return corners
    .map(([lng, lat]) => {
      const x = offsetX + (lng - minLng) * scale;
      const y = offsetY + (maxLat - lat) * scale; // flip: lat increases upward, svg y downward
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}