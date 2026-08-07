import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * Aggregated parcel record: base parcel attributes + a spatial join to
 * whichever subdivision this parcel's geometry overlaps most, plus a
 * per-zoning-code average $/acre computed from the rest of the dataset
 * (used as the "value efficiency" grading input).
 *
 * This is the "LITE" grade — three factors only (zoning fit, size,
 * value efficiency). It deliberately excludes a constraint penalty
 * (e.g. flood exposure) because no constraint layer has been ingested
 * yet. Once one exists, add its overlap % as a 4th factor here and in
 * scoreParcel() below — nothing else about this route needs to change.
 */
const DETAIL_QUERY = `
  WITH parcel AS (
    SELECT id, geo_id, prop_id, name, zoning, zoning_desc, acreage, market_value, geom
    FROM parcels
    WHERE id = $1
  ),
  best_subdivision AS (
    -- A parcel can technically straddle more than one subdivision
    -- boundary (edge slivers, data misalignment) — pick whichever one
    -- it overlaps the most, not just the first match.
    SELECT s.subdivision_name, s.plat_number
    FROM subdivisions s, parcel
    WHERE ST_Intersects(s.geom, parcel.geom)
    ORDER BY ST_Area(ST_Intersection(s.geom, parcel.geom)) DESC
    LIMIT 1
  ),
  zoning_avg AS (
    -- Average $/acre across other parcels sharing this parcel's zoning
    -- code, used as the comparison baseline for value efficiency.
    -- Excludes the subject parcel itself and anything with no usable
    -- acreage/value so a handful of bad rows can't skew the average.
    SELECT AVG(p2.market_value / NULLIF(p2.acreage, 0)) AS avg_value_per_acre
    FROM parcels p2, parcel
    WHERE p2.zoning = parcel.zoning
      AND p2.id != parcel.id
      AND p2.acreage > 0
      AND p2.market_value > 0
  )
  SELECT
    parcel.id,
    parcel.geo_id,
    parcel.prop_id,
    parcel.name,
    parcel.zoning,
    parcel.zoning_desc,
    parcel.acreage,
    parcel.market_value,
    best_subdivision.subdivision_name,
    best_subdivision.plat_number,
    zoning_avg.avg_value_per_acre
  FROM parcel
  LEFT JOIN best_subdivision ON true
  LEFT JOIN zoning_avg ON true;
`;

// --- Lite grading logic ---
// Each factor is scored 0-100 with a human-readable reason. Any factor
// that can't be computed (missing data) is dropped from the average
// rather than counted as zero, and the weights re-normalize over
// whatever's left.

function scoreZoningFit(zoning, zoningDesc) {
  const text = `${zoning || ''} ${zoningDesc || ''}`.toLowerCase();
  if (!text.trim()) return null; // no zoning info at all — exclude, don't penalize

  if (text.includes('resid')) return { score: 90, reason: 'Zoned for residential use' };
  if (text.includes('commerc')) return { score: 80, reason: 'Zoned for commercial use' };
  if (text.includes('agricult') || text.includes('rural')) {
    return { score: 70, reason: 'Zoned agricultural/rural — usable but lower-density' };
  }
  if (text.includes('conserv') || text.includes('critical')) {
    return { score: 35, reason: 'Zoned for conservation/critical area — heavily restricted use' };
  }
  return { score: 60, reason: `Zoning "${zoning}" — no strong fit signal either way` };
}

function scoreSizeAdequacy(acreage) {
  if (acreage == null) return null;
  const a = Number(acreage);
  if (!Number.isFinite(a) || a <= 0) return null;

  if (a < 0.25) return { score: 40, reason: `${a.toFixed(2)} acres — quite small, limits usable options` };
  if (a < 1) return { score: 65, reason: `${a.toFixed(2)} acres — modest size` };
  if (a < 5) return { score: 85, reason: `${a.toFixed(2)} acres — solid, flexible size` };
  if (a < 20) return { score: 90, reason: `${a.toFixed(2)} acres — large, high development potential` };
  return { score: 75, reason: `${a.toFixed(2)} acres — very large, may be harder to move as one deal` };
}

function scoreValueEfficiency(marketValue, acreage, avgValuePerAcre) {
  if (marketValue == null || acreage == null || avgValuePerAcre == null) return null;
  const acre = Number(acreage);
  const value = Number(marketValue);
  const avg = Number(avgValuePerAcre);
  if (!Number.isFinite(acre) || acre <= 0 || !Number.isFinite(value) || !Number.isFinite(avg) || avg <= 0) {
    return null;
  }

  const perAcre = value / acre;
  const ratio = perAcre / avg; // < 1 = cheaper than similar-zoned parcels

  if (ratio <= 0.75) {
    return { score: 95, reason: `Priced well below similar-zoned parcels ($${Math.round(perAcre).toLocaleString()}/acre vs ~$${Math.round(avg).toLocaleString()} avg)` };
  }
  if (ratio <= 1.0) {
    return { score: 80, reason: `Priced at or slightly below similar-zoned parcels ($${Math.round(perAcre).toLocaleString()}/acre vs ~$${Math.round(avg).toLocaleString()} avg)` };
  }
  if (ratio <= 1.3) {
    return { score: 55, reason: `Priced somewhat above similar-zoned parcels ($${Math.round(perAcre).toLocaleString()}/acre vs ~$${Math.round(avg).toLocaleString()} avg)` };
  }
  return { score: 30, reason: `Priced well above similar-zoned parcels ($${Math.round(perAcre).toLocaleString()}/acre vs ~$${Math.round(avg).toLocaleString()} avg)` };
}

function gradeFromScore(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function scoreParcel(row) {
  const factors = [
    scoreZoningFit(row.zoning, row.zoning_desc),
    scoreSizeAdequacy(row.acreage),
    scoreValueEfficiency(row.market_value, row.acreage, row.avg_value_per_acre),
  ].filter(Boolean);

  if (factors.length === 0) {
    return { grade: null, score: null, reasons: ['Not enough data to grade this parcel yet'] };
  }

  const avgScore = factors.reduce((sum, f) => sum + f.score, 0) / factors.length;
  return {
    grade: gradeFromScore(avgScore),
    score: Math.round(avgScore),
    reasons: factors.map((f) => f.reason),
  };
}

export async function GET(_request, { params }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid parcel id' }, { status: 400 });
  }

  try {
    const result = await pool.query(DETAIL_QUERY, [id]);
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Parcel not found' }, { status: 404 });
    }

    const { grade, score, reasons } = scoreParcel(row);

    return NextResponse.json({
      id: row.id,
      geoId: row.geo_id,
      propId: row.prop_id,
      name: row.name,
      zoning: row.zoning,
      zoningDesc: row.zoning_desc,
      acreage: row.acreage,
      marketValue: row.market_value,
      subdivisionName: row.subdivision_name,
      platNumber: row.plat_number,
      grade,
      gradeScore: score,
      gradeReasons: reasons,
    });
  } catch (err) {
    console.error('Parcel detail query failed:', err);
    return NextResponse.json({ error: 'Failed to load parcel detail' }, { status: 500 });
  }
}
