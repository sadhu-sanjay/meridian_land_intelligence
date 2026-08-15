import { NextResponse } from "next/server";
import { findParcelsWithinArea } from "@/lib/repositories/parcels";


export async function POST(req) {
  try {
    const { corners, cityId, sizeFilter, quickFilters } = await req.json();

    if (!cityId && (!Array.isArray(corners) || corners.length !== 4)) {
      return NextResponse.json(
        { error: "either a cityId or 4 [lng, lat] corners are required" },
        { status: 400 },
      );
    }

    const parcels = await findParcelsWithinArea({ corners, cityId, sizeFilter, quickFilters });
    return NextResponse.json({ count: parcels.length, parcels });
  } catch (err) {
    console.error("parcels/within failed:", err);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}