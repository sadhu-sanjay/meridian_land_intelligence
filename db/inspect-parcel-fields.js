/**
 * inspect-parcel-fields.js
 *
 * One-off helper: fetches a single record (all fields) from Whatcom
 * County's parcel layer so you can confirm real field names before
 * trusting FIELD_MAP in sync-parcels.js. Mirrors whatever
 * inspect-zoning-fields.js did for the zoning layer.
 *
 * Usage: node db/inspect-parcel-fields.js
 */

const BASE_URL =
  "https://gis.whatcomcounty.us/arcgis/rest/services/EnterprisePublishing/WhatcomCo_Property/MapServer/1";

async function main() {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    outSR: "4326",
    f: "json",
    resultRecordCount: "1",
  });

  const res = await fetch(`${BASE_URL}/query?${params.toString()}`);
  const data = await res.json();

  if (data.error) {
    console.error("ArcGIS error:", data.error);
    process.exit(1);
  }

  const feature = data.features?.[0];
  if (!feature) {
    console.error("No features returned — check BASE_URL / layer index.");
    process.exit(1);
  }

  console.log("Available fields and a sample record:\n");
  console.log(JSON.stringify(feature.attributes, null, 2));
  console.log(
    "\nCross-check these keys against FIELD_MAP in sync-parcels.js and update as needed."
  );
}

main().catch((err) => {
  console.error("Inspection failed:", err);
  process.exit(1);
});
