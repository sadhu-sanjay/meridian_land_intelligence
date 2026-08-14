"use client";

// Small read-only preview card shown on hover over a map feature
// (parcel, zoning, subdivision, or city). Purely presentational —
// `info` is whatever MapView's unified hover handler last reported,
// or null when nothing is hovered.
//
// Positioned top-right, offset far enough from the edge to clear
// maplibre's NavigationControl (also top-right, ~10px margin + ~29px
// wide) so the two never overlap. pointer-events: none so the card
// itself never becomes the thing the mouse is "over" and can't cause
// hover flicker.

const CARD_STYLE = {
  position: "absolute",
  bottom: 56,
  right: 56,
  background: "var(--ink-2)",
  color: "var(--paper)",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid rgba(210, 196, 164, 0.35)",
  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.28)",
  fontSize: 13,
  lineHeight: 1.4,
  minWidth: 160,
  maxWidth: 240,
  pointerEvents: "none",
  zIndex: 5,
};

function renderBody(info) {
  switch (info.kind) {
    case "parcel":
      return (
        <>
          <strong style={{ color: "var(--paper)", fontWeight: 700 }}>
            {info.name || `Parcel ${info.propId || info.id || ""}`}
          </strong>
          {info.zoning && <div style={{ color: "var(--muted)", marginTop: 2 }}>{info.zoning}</div>}
          {info.acreage != null && (
            <div style={{ color: "var(--muted)" }}>{Number(info.acreage).toFixed(2)} acres</div>
          )}
        </>
      );
    case "zoning":
      return (
        <>
          <strong style={{ color: "var(--ochre)", fontWeight: 700 }}>
            {info.zone_code || "Unknown zone"}
          </strong>
          {info.zone_desc && <div style={{ color: "var(--muted)", marginTop: 2 }}>{info.zone_desc}</div>}
        </>
      );
    case "subdivision":
      return (
        <>
          <strong style={{ color: "var(--paper)", fontWeight: 700 }}>
            {info.subdivisionName || info.name || "Unknown subdivision"}
          </strong>
          {info.acreage != null && (
            <div style={{ color: "var(--muted)", marginTop: 2 }}>
              {Number(info.acreage).toFixed(2)} acres
            </div>
          )}
          <strong style={{ color: "var(--ochre)", fontWeight: 700, marginTop: 4, display: "block" }}>
            A subdivision
          </strong>
        </>
      );
    case "city":
      return (
        <>
          <strong style={{ color: "var(--paper)", fontWeight: 700 }}>
            {info.city_name || "Unknown city"}
          </strong>
          {info.city_type && <div style={{ color: "var(--muted)", marginTop: 2 }}>{info.city_type}</div>}
        </>
      );
    default:
      return null;
  }
}

export default function InfoCard({ info }) {
  if (!info) return null;
  return <div style={CARD_STYLE}>{renderBody(info)}</div>;
}
