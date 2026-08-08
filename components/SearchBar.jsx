"use client";

import { useEffect, useRef, useState } from "react";

// Debounce delay between the user typing and the search request firing.
const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

// Formats a result's secondary line: prefers owner name (most useful for
// disambiguating "which Main St parcel"), falls back to zoning.
function subtitleFor(result) {
  if (result.owner_name) return result.owner_name;
  if (result.zoning) return `Zoning: ${result.zoning.trim()}`;
  return result.geo_id;
}

export default function SearchBar({ value, onChange, onSelect, placeholder }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0); // guards against out-of-order responses

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      try {
        const res = await fetch(
          `/api/parcels/search?q=${encodeURIComponent(query)}`,
        );
        const data = await res.json();
        // Drop stale responses — a slower earlier request landing after
        // a newer one would otherwise flash outdated results.
        if (requestId !== requestIdRef.current) return;
        setResults(data.results || []);
        setOpen(true);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error("parcel search failed:", err);
        setResults([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [value]);

  const handleSelect = (result) => {
    setOpen(false);
    onSelect(result);
  };

  return (
    <div className="searchbar" style={{ position: "relative" }}>
      <input
        id="searchInput"
        type="text"
        placeholder={placeholder || "Search parcel, zoning, corridor…"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // allow click to register first
      />

      {open && (loading || results.length > 0) && (
        <ul
          className="searchbar-results"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            margin: 0,
            padding: 0,
            listStyle: "none",
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {loading && (
            <li style={{ padding: "10px 12px", color: "#999", fontSize: 13 }}>
              Searching…
            </li>
          )}

          {!loading && results.length === 0 && (
            <li style={{ padding: "10px 12px", color: "#999", fontSize: 13 }}>
              No parcels found
            </li>
          )}

          {!loading &&
            results.map((result) => (
              <li
                key={result.id}
                // onMouseDown fires before the input's onBlur, so the
                // click registers before the dropdown closes.
                onMouseDown={() => handleSelect(result)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {result.name || result.geo_id}
                </div>
                <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>
                  {subtitleFor(result)}
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
