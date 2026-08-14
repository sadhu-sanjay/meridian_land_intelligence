import { NextResponse } from "next/server";
import { findParcelsWithinArea } from "@/lib/repositories/parcels";
// This route is a thin wrapper — it doesn't touch the database itself,
// it just parses the incoming request and hands off to the repo function
// above. If you ever need this same search from somewhere else (a script,
// a different route), you call findParcelsWithinArea() directly instead
// of duplicating this logic.

// POST because the request needs a body (corners, filters) — GET requests
// don't carry a body in the same way, and this payload is more than a
// couple of short query-string params.
export async function POST(req) {
  try {
    // req.json() reads and parses the JSON body the client sent —
    // this is an async operation because the body streams in over the
    // network, so we await it.
    const { corners, sizeFilter, quickFilters } = await req.json();

    // Basic input validation — if the client didn't send exactly 4
    // corners, there's no valid polygon to search with, so fail fast
    // with a clear 400 (bad request) instead of letting a confusing
    // Postgres error happen further down.
    if (!Array.isArray(corners) || corners.length !== 4) {
      return NextResponse.json(
        { error: "corners must be an array of 4 [lng, lat] pairs" },
        { status: 400 }, // 400 = client sent something wrong
      );
    }

    // Hand off to the repo function — this is the only line that
    // actually touches the database.
    const parcels = await findParcelsWithinArea({ corners, sizeFilter, quickFilters });

    // Return both the array AND a separate count — the sidebar mostly
    // just needs the number ("47 parcels found"), so giving it as its
    // own field means the frontend doesn't need to run parcels.length
    // itself, and it stays correct even if you later paginate/limit
    // the parcels array without changing what "count" means.
    return NextResponse.json({ count: parcels.length, parcels });
  } catch (err) {
    // Anything that throws above (bad WKT, DB connection issue, etc.)
    // lands here. Log the real error server-side for debugging, but
    // send back a generic message to the client — don't leak internal
    // error details (like raw SQL) to the browser.
    console.error("parcels/within failed:", err);
    return NextResponse.json({ error: "search failed" }, { status: 500 }); // 500 = server-side failure
  }
}
