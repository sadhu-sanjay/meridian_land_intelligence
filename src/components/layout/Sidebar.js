"use client";

import { useMemo, useState } from "react";
import SearchBar from "@/components/search/SearchBar";

const QUICK_FILTERS = [
  {
    id: "vacant_lots",
    label: "Vacant Lots",
    hint: "No structure on the parcel",
  },
  {
    id: "vacant_structures",
    label: "Vacant Structures",
    hint: "Has a building, currently unoccupied",
  },
  {
    id: "residential",
    label: "Residential Properties",
    hint: "Zoned or used for residential",
  },
];

// "Around X sqft" is an approximate-match filter, not an exact one —
// nobody has a parcel that's precisely 600.00 sqft. We resolve it to a
// tolerance band (default ±20%) around the entered value.
const TOLERANCE_PERCENT = 20;

// Slider bounds for the parcel-size control. Investors browsing an area
// tend to think in round sqft numbers, so we step in increments of 50.
const SIZE_MIN = 0;
const SIZE_MAX = 20000;
const SIZE_STEP = 50;

export default function Sidebar({
  searchValue,
  onSearchChange,
  onSearchSelect,
  activeQuickFilters, // string[] — optional, controlled from parent
  onQuickFilterChange, // (id[]) => void
  sizeFilter, // { value: string } — optional, controlled from parent; always sqft
  onSizeFilterChange, // ({ value }) => void
  onSearch, // ({ searchValue, quickFilters, sizeFilter }) => void — fired by the Search button
}) {
  // Uncontrolled fallback so this renders standalone before it's wired
  // up to page.js state.
  const [localQuickFilters, setLocalQuickFilters] = useState([]);
  const [localValue, setLocalValue] = useState("");

  const quickFilters = activeQuickFilters ?? localQuickFilters;
  const value = sizeFilter?.value ?? localValue;

  // Multi-select: each button just toggles its own membership in the
  // list, independent of the others.
  const handleQuickFilterClick = (id) => {
    const next = quickFilters.includes(id)
      ? quickFilters.filter((f) => f !== id)
      : [...quickFilters, id];
    onQuickFilterChange ? onQuickFilterChange(next) : setLocalQuickFilters(next);
  };

  const handleValueChange = (nextValue) => {
    if (onSizeFilterChange) onSizeFilterChange({ value: nextValue });
    else setLocalValue(nextValue);
  };

  // Preview text: just the tolerance band in sqft, since that's the
  // only unit this filter speaks now.
  const sizePreview = useMemo(() => {
    const sqft = parseFloat(value);
    if (!sqft || sqft <= 0) return null;

    const lowSqft = sqft * (1 - TOLERANCE_PERCENT / 100);
    const highSqft = sqft * (1 + TOLERANCE_PERCENT / 100);

    return {
      lowSqft: Math.round(lowSqft).toLocaleString(),
      highSqft: Math.round(highSqft).toLocaleString(),
    };
  }, [value]);

  const sliderValue = value === "" || value == null ? SIZE_MIN : Number(value);

  const handleSearchClick = () => {
    if (!onSearch) return;
    onSearch({
      searchValue,
      quickFilters,
      sizeFilter: {
        value,
        lowSqft: sizePreview?.lowSqft ?? null,
        highSqft: sizePreview?.highSqft ?? null,
      },
    });
  };

  // The area search floats top-right, independent of the sidebar column,
  // so it needs to render as a sibling of <aside> rather than inside it.
  // Its positioning is relative to .app-shell (position: relative), so it
  // sits above whatever's underneath — normally the map area.
  return (
    <>
      <div className="area-search-float">
        {/* <p className="eyebrow">Area</p>
        <p className="section-hint">
          Search a city, neighborhood, or address — e.g. Bellingham.
        </p> */}
        <div className="searchrow">
          <SearchBar
            value={searchValue}
            onChange={onSearchChange}
            onSelect={onSearchSelect}
          />
        </div>
      </div>

      <aside className="sidebar">
        {/* Parcel size */}
        <div className="sidebar-section">
          <p className="eyebrow">Parcel Size</p>

          <div className="size-filter-slider-row">
            <input
              type="range"
              className="size-filter-slider"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={SIZE_STEP}
              value={sliderValue}
              onChange={(e) => handleValueChange(e.target.value)}
              aria-label="Parcel size in square feet"
            />
            <div className="size-filter-value">
              <input
                type="number"
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={SIZE_STEP}
                placeholder="e.g. 600"
                value={value}
                onChange={(e) => handleValueChange(e.target.value)}
              />
              <span className="size-filter-unit-label">sq ft</span>
            </div>
          </div>

          <div className="size-filter-range-labels">
            <span>{SIZE_MIN.toLocaleString()}</span>
            <span>{SIZE_MAX.toLocaleString()}+</span>
          </div>

          {sizePreview && (
            <p className="size-filter-tolerance">
              About <b>{sizePreview.lowSqft}–{sizePreview.highSqft} sq ft</b>{" "}
              (±{TOLERANCE_PERCENT}%)
            </p>
          )}
        </div>

        {/* Property type */}
        <div className="sidebar-section">
          <p className="eyebrow">Property Type</p>
          <p className="section-hint">Vacant lot, vacant structure, or residential.</p>
          <div className="quick-filters">
            {QUICK_FILTERS.map((qf) => {
              const isActive = quickFilters.includes(qf.id);
              return (
                <button
                  key={qf.id}
                  type="button"
                  className={`quick-filter-btn${isActive ? " active" : ""}`}
                  onClick={() => handleQuickFilterClick(qf.id)}
                  title={qf.hint}
                  aria-pressed={isActive}
                >
                  {qf.label}
                  <span className="qf-check" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Run it */}
        <div className="sidebar-section sidebar-search-action">
          <button
            type="button"
            className="sidebar-search-btn"
            onClick={handleSearchClick}
          >
            Search
          </button>
        </div>
      </aside>
    </>
  );
}
