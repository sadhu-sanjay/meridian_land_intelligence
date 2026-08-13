"use client";

import { useMemo, useState } from "react";
import SearchBar from "@/components/search/SearchBar";
import AreaSelectIcon from "@/components/icons/AreaSelectIcon";

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

// Bounds for the parcel-size input.
const SIZE_MIN = 0;
const SIZE_MAX = 20000;

export default function Sidebar({
  searchValue,
  onSearchChange,
  onSearchSelect,
  areaOptions = [], // (string | { value, label })[] — available areas/cities for the dropdown
  selectedArea, // string — optional, controlled from parent
  onAreaChange, // (value) => void
  activeQuickFilters, // string[] — optional, controlled from parent
  onQuickFilterChange, // (id[]) => void
  sizeFilter, // { value: string } — optional, controlled from parent; always sqft
  onSizeFilterChange, // ({ value }) => void
  onSearch, // ({ searchValue, quickFilters, sizeFilter }) => void — fired by the Search button
}) {
  // Uncontrolled fallback so this renders standalone before it's wired
  // up to page.js state.
  const [localQuickFilters, setLocalQuickFilters] = useState([]);
  // Defaults to 600 sqft — the common case investors search for.
  const [localValue, setLocalValue] = useState("600");
  const [localArea, setLocalArea] = useState("");
  const [mapSelectActive, setMapSelectActive] = useState(false);
  const handleMapSelectClick = () => {
    const next = !mapSelectActive;
    setMapSelectActive(next);
    if (next) {
      // Picking map mode clears whatever city was selected
      handleAreaChange("");
    }
  };

  const handleAreaSelectChange = (nextArea) => {
    handleAreaChange(nextArea);
    if (nextArea) {
      // Picking a city turns map mode off
      setMapSelectActive(false);
    }
  };

  const quickFilters = activeQuickFilters ?? localQuickFilters;
  const value = sizeFilter?.value ?? localValue;
  const area = selectedArea ?? localArea;

  // Multi-select: each button just toggles its own membership in the
  // list, independent of the others.
  const handleQuickFilterClick = (id) => {
    const next = quickFilters.includes(id)
      ? quickFilters.filter((f) => f !== id)
      : [...quickFilters, id];
    onQuickFilterChange
      ? onQuickFilterChange(next)
      : setLocalQuickFilters(next);
  };

  const handleValueChange = (nextValue) => {
    if (onSizeFilterChange) onSizeFilterChange({ value: nextValue });
    else setLocalValue(nextValue);
  };

  const handleAreaChange = (nextArea) => {
    if (onAreaChange) onAreaChange(nextArea);
    else setLocalArea(nextArea);
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

  // The area *search* box (address/place autocomplete) floats top-right,
  // independent of the sidebar column, so it renders as a sibling of
  // <aside> rather than inside it — positioned relative to .app-shell
  // (position: relative), sitting above whatever's underneath (normally
  // the map area). The area/city *dropdown* is a separate control and
  // lives inline as the first section of the sidebar itself.
  return (
    <>
      <style>{`
        .size-filter-input-no-spinner::-webkit-outer-spin-button,
        .size-filter-input-no-spinner::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .size-filter-input-no-spinner {
          -moz-appearance: textfield;
        }
      `}</style>

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
        {/* Area — pick a city, or draw one on the map. Mutually exclusive. */}
        <div className="sidebar-section">
          <p className="eyebrow">Area</p>
          <div className="area-choice-row">
            <button
              type="button"
              className={`map-select-btn${mapSelectActive ? " active" : ""}`}
              onClick={handleMapSelectClick}
              aria-pressed={mapSelectActive}
              title="Draw a custom boundary on the map"
            >
              <AreaSelectIcon active={mapSelectActive} />
              <span>Select on Map</span>
            </button>

            <span className="area-choice-or">or</span>

            <div className="area-select-dropdown">
              <select
                className="area-select"
                value={area}
                onChange={(e) => handleAreaSelectChange(e.target.value)}
                disabled={mapSelectActive}
                aria-label="Select an area or city"
              >
                <option value="" disabled>
                  Select a city
                </option>
                {areaOptions.map((opt) => {
                  const optValue = typeof opt === "string" ? opt : opt.value;
                  const optLabel = typeof opt === "string" ? opt : opt.label;
                  return (
                    <option key={optValue} value={optValue}>
                      {optLabel}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        {/* Parcel size */}
        <div className="sidebar-section">
          <p className="eyebrow">Parcel Size</p>

          <div className="size-filter-value">
            <input
              type="number"
              className="size-filter-input-no-spinner"
              min={SIZE_MIN}
              max={SIZE_MAX}
              placeholder="e.g. 600"
              value={value}
              onChange={(e) => handleValueChange(e.target.value)}
            />
            <span className="size-filter-unit-label">sq ft</span>
          </div>

          {sizePreview && (
            <p className="size-filter-tolerance">
              About{" "}
              <b>
                {sizePreview.lowSqft}–{sizePreview.highSqft} sq ft
              </b>{" "}
              (±{TOLERANCE_PERCENT}%)
            </p>
          )}
        </div>

        {/* Property type */}
        <div className="sidebar-section">
          <p className="eyebrow">Property Type</p>
          <p className="section-hint">
            Vacant lot, vacant structure, or residential.
          </p>
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
