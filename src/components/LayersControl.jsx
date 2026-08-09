"use client";

import { useState } from "react";

// Floating layers toggle button + panel, rendered on top of the map.
// Purely presentational — visibility state and the toggle handler are
// owned by the caller (MapView), which is the thing that actually knows
// how to apply changes to maplibre layers. The open/closed state of the
// panel itself is local since nothing outside this component cares
// about it.
export default function LayersControl({ groups, visibility, onToggle }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "absolute", bottom: 24, left: 10, zIndex: 1 }}>
      {open && (
        <div
          style={{
            marginBottom: 8,
            background: "#1e2a22",
            border: "1px solid #3a4a3f",
            borderRadius: 6,
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
            padding: "8px 10px",
            minWidth: 150,
            fontFamily: "IBM Plex Sans, sans-serif",
            fontSize: 13,
            color: "#efe7d2",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#efe7d2" }}>
            Layers
          </div>
          {groups.map((group) => (
            <label
              key={group.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 0",
                cursor: "pointer",
                color: "#efe7d2",
              }}
            >
              <input
                type="checkbox"
                checked={visibility[group.key]}
                onChange={() => onToggle(group.key)}
                style={{ accentColor: "#c9922f" }}
              />
              {group.label}
            </label>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle layers panel"
        aria-expanded={open}
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e2a22",
          border: "1px solid #3a4a3f",
          borderRadius: 6,
          boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
          cursor: "pointer",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#efe7d2"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </button>
    </div>
  );
}
