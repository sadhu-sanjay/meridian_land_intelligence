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
        placeholder={placeholder || "🔍︎  Search an address, place , parcelnumber or lat/lng"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // allow click to register first
      />

      {open && (loading || results.length > 0) && (
        <ul className="searchbar-results">
          {loading && (
            <li className="searchbar-result searchbar-result--muted">
              Searching…
            </li>
          )}

          {!loading && results.length === 0 && (
            <li className="searchbar-result searchbar-result--muted">
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
                className="searchbar-result"
              >
                <div className="searchbar-result-title">
                  {result.name || result.geo_id}
                </div>
                <div className="searchbar-result-subtitle">
                  {subtitleFor(result)}
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
