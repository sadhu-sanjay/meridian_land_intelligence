import { NextResponse } from "next/server";
import { getAreas } from "@/lib/repositories/areas";

export const revalidate = 3600; // cities barely change — cache for an hour

export async function GET() {
  try {
    const areas = await getAreas();
    return NextResponse.json({ areas });
  } catch (err) {
    console.error("areas fetch failed:", err);
    return NextResponse.json({ error: "failed to load areas" }, { status: 500 });
  }
}