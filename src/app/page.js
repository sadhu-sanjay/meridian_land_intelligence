"use client";

import { useRef, useState } from "react";
import { ParcelDetailDrawer } from "@/components/parcel_detail";
import SearchBar from "@/components/SearchBar";
import Header from "@/components/header";
import MapView, {
  DEFAULT_COLOR,
  SUBDIVISION_COLOR,
} from "@/components/MapView";
import "./shell.css";

export default function Page() {
  const mapViewRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [searchValue, setSearchValue] = useState("");

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
    }
    const lngLat =
      result.lng != null && result.lat != null
        ? { lng: result.lng, lat: result.lat }
        : null;
    loadParcelDetail(result.id, lngLat);
  };

  return (
    <div className="app-shell">
      <Header />
      <div className="app-body">
        <div className="map-area">
          <div className="floating-searchbar">
            <SearchBar
              value={searchValue}
              onChange={setSearchValue}
              onSelect={handleSearchSelect}
            />
          </div>

          <MapView
            ref={mapViewRef}
            onParcelClick={loadParcelDetail}
            onSubdivisionClick={(subdivision) =>
              setSelected({ kind: "subdivision", ...subdivision })
            }
            onZoningClick={(zoning) =>
              setSelected({ kind: "zoning", ...zoning })
            }
            onError={setLoadError}
          />

            
            {loadError && (
              <div style={{ color: "#c0392b", marginTop: 6 }}>
                Error: {loadError}
              </div>
            )}

          {selected && selected.kind === "zoning" && (
            <div
              style={{
                position: "absolute",
                bottom: 20,
                left: 12,
                background: "white",
                padding: "12px 16px",
                borderRadius: 8,
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                fontSize: 13,
                minWidth: 200,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ display: "flex", alignItems: "center" }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: selected.color || DEFAULT_COLOR,
                      display: "inline-block",
                      marginRight: 6,
                    }}
                  />
                  <strong>{selected.zone_code || "Unknown zone"}</strong>
                </span>
                <span
                  onClick={() => setSelected(null)}
                  style={{ cursor: "pointer", color: "#999", marginLeft: 12 }}
                >
                  ✕
                </span>
              </div>
            </div>
          )}

          <ParcelDetailDrawer
            selected={selected}
            detailLoading={detailLoading}
            onClose={() => setSelected(null)}
          />

          {selected && selected.kind === "subdivision" && (
            <div
              style={{
                position: "absolute",
                bottom: 20,
                left: 12,
                background: "white",
                padding: "12px 16px",
                borderRadius: 8,
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                fontSize: 13,
                minWidth: 200,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ display: "flex", alignItems: "center" }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: SUBDIVISION_COLOR,
                      display: "inline-block",
                      marginRight: 6,
                    }}
                  />
                  <strong>
                    {selected.subdivisionName ||
                      selected.name ||
                      "Unknown subdivision"}
                  </strong>
                </span>
                <span
                  onClick={() => setSelected(null)}
                  style={{ cursor: "pointer", color: "#999", marginLeft: 12 }}
                >
                  ✕
                </span>
              </div>
              {selected.acreage != null && (
                <div style={{ marginTop: 4, color: "#666" }}>
                  {Number(selected.acreage).toFixed(2)} acres
                </div>
              )}
              {selected.platNumber && (
                <div style={{ marginTop: 4, color: "#999", fontSize: 11 }}>
                  plat #: {selected.platNumber}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
