"use client";

// Floating button for the "select a 4-corner area" tool, rendered on
// top of the map next to LayersControl. Purely presentational — all it
// does is show the current state (off / collecting corners) and call
// back into usePolygonAreaSelect's start/cancel/undo. It has no idea
// how the drawing itself works.
export default function PolygonAreaControl({ active, pointCount, start, cancel, undo }) {
  return (
    <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1 }}>
      {active && (
        <div
          style={{
            marginBottom: 8,
            background: "#1e2a22",
            border: "1px solid #3a4a3f",
            borderRadius: 6,
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
            padding: "8px 10px",
            minWidth: 190,
            fontFamily: "IBM Plex Sans, sans-serif",
            fontSize: 13,
            color: "#efe7d2",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Click {4 - pointCount} more corner{4 - pointCount === 1 ? "" : "s"}
          </div>
          <div style={{ color: "#9aa5b1", fontSize: 11.5, marginBottom: 8 }}>
            Point {pointCount} of 4
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={undo}
              disabled={pointCount === 0}
              style={controlBtnStyle(pointCount === 0)}
            >
              Undo
            </button>
            <button type="button" onClick={cancel} style={controlBtnStyle(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      
    </div>
  );
}

function controlBtnStyle(disabled) {
  return {
    flex: 1,
    padding: "5px 0",
    background: "#121814",
    border: "1px solid #3a4a3f",
    borderRadius: 4,
    color: disabled ? "#5a6560" : "#efe7d2",
    fontFamily: "IBM Plex Sans, sans-serif",
    fontSize: 11.5,
    cursor: disabled ? "default" : "pointer",
  };
}
