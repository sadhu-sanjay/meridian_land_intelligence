"use client";

import { useRef, useState, useEffect } from "react";
import { ParcelDetailDrawer } from "@/components/parcel/parcel_detail";
import Header from "@/components/layout/header";
import MapView from "@/components/map/MapView";
import InfoCard from "@/components/label/InfoCard";
import "./shell.css";
import Sidebar from "@/components/layout/Sidebar";
import { computeAreaStats } from "@/lib/geo";

export default function Page() {
  const mapViewRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [searchValue, setSearchValue] = useState("");
  const [areaOptions, setAreaOptions] = useState([]);
  const [selectedArea, setSelectedArea] = useState("");
  const [mapSelectActive, setMapSelectActive] = useState(false);
  const [mapAreaSelection, setMapAreaSelection] = useState(null); // { corners, acres, sqft } | null
  // Holds the last search result: null until a search has actually run.
  // Once it has a value, it's always shaped { count, parcels }.
  const [searchResults, setSearchResults] = useState(null);

  // This function is passed to <Sidebar onSearch={...}> — Sidebar calls it
  // with { searchValue, quickFilters, sizeFilter } whenever the Search
  // button is clicked (see Sidebar's handleSearchClick).
  const handleSearch = async ({ quickFilters, sizeFilter }) => {
    // Guard clause: if the user hasn't drawn an area yet
    if (!mapAreaSelection?.corners) return;

    try {
      const res = await fetch("/api/parcels/within", {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // tells the server to expect JSON
        body: JSON.stringify({
          corners: mapAreaSelection.corners, // the drawn shape, stored earlier
          sizeFilter, // passed straight through from Sidebar
          quickFilters, // same
        }),
      });

      const data = await res.json(); // shape: { count, parcels } or { error }

      setSearchResults(data);
    } catch (err) {
      console.error("search failed:", err);
    }
  };

  const handleAreaSelectComplete = (corners) => {
    const stats = computeAreaStats(corners);
    setMapAreaSelection({ corners, ...stats });
    setMapSelectActive(false);
  };

  const handleClearMapSelection = () => {
    setMapAreaSelection(null);
    mapViewRef.current?.cancelAreaSelect(); // also wipes the drawn shape on the map
  };

  useEffect(() => {
    fetch("/api/areas")
      .then((res) => res.json())
      .then((data) => setAreaOptions(data.areas ?? []))
      .catch((err) => console.error("failed to load areas:", err));
  }, []);

  // Fetches the aggregated parcel record (zoning + acreage + subdivision +
  // value + grade, all resolved server-side) for the clicked parcel id.
  const loadParcelDetail = async (id, lngLat) => {
    setDetailLoading(true);
    setSelected({ kind: "parcel", id, lngLat }); // show the card immediately, filled in once data lands
    try {
      const res = await fetch(`/api/parcels/${id}/detail`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setSelected({ kind: "parcel", lngLat, ...data });
    } catch (err) {
      setSelected({ kind: "parcel", id, lngLat, error: err.message });
    } finally {
      setDetailLoading(false);
    }
  };

  // Handles picking a result from the search dropdown — flies the map to
  // the parcel's centroid (surface_point, from the search API) and opens
  // the same detail drawer a map click would, so search and click land
  // on identical UI.
  const handleSearchSelect = (result) => {
    if (result.lng != null && result.lat != null) {
      mapViewRef.current?.flyTo(result.lng, result.lat, 16);
      mapViewRef.current?.selectParcel(result.id);
    }
    const lngLat =
      result.lng != null && result.lat != null
        ? { lng: result.lng, lat: result.lat }
        : null;
    loadParcelDetail(result.id, lngLat);
  };

  // Map reports its real active/pointCount state back — this is the
  // source of truth (also covers the case where the user finishes/cancels
  // via the floating map control instead of the sidebar button).
  const handleAreaSelectStateChange = ({ active }) => {
    setMapSelectActive(active);
  };

  const handleMapSelectToggle = () => {
    if (mapSelectActive) {
      mapViewRef.current?.cancelAreaSelect();
    } else {
      setSelectedArea(""); // mutual exclusivity: drawing cancels the city pick
      mapViewRef.current?.startAreaSelect();
    }
  };

  return (
    <div className="app-shell">
      <Header />
      <div className="app-body">
        <Sidebar
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          onSearchSelect={handleSearchSelect}
          areaOptions={areaOptions}
          selectedArea={selectedArea}
          onAreaChange={setSelectedArea}
          mapSelectActive={mapSelectActive}
          onMapSelectToggle={handleMapSelectToggle}
          mapAreaSelection={mapAreaSelection}
          onClearMapSelection={handleClearMapSelection}
          onSearch={handleSearch}
        />

        <div className="map-area">
          <MapView
            ref={mapViewRef}
            onParcelClick={loadParcelDetail}
            onSubdivisionClick={(subdivision) =>
              setSelected({ kind: "subdivision", ...subdivision })
            }
            onZoningClick={(zoning) =>
              setSelected({ kind: "zoning", ...zoning })
            }
            onFeatureHover={setHovered}
            setSelected={setSelected}
            onError={setLoadError}
            onAreaSelect={handleAreaSelectComplete}
            onAreaSelectStateChange={handleAreaSelectStateChange}
            searchResults={searchResults}
          />

          <InfoCard info={hovered} />

          {loadError && (
            <div style={{ color: "#c0392b", margin: "auto" }}>
              Error: {loadError}
            </div>
          )}

          <ParcelDetailDrawer
            selected={selected}
            detailLoading={detailLoading}
            onClose={() => setSelected(null)}
          />
        </div>
      </div>
    </div>
  );
}
