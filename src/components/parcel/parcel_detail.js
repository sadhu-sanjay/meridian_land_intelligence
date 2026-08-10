'use client';

// Land grade badge colors — aligned with Meridian palette from index.html
// A/Strong Buy → F/Avoid. Also maps numeric score bands used by index.html.
const GRADE_COLORS = {
  A: '#4F8657',
  B: '#C9922F',
  C: '#C2703E',
  D: '#A23E32',
  F: '#A23E32',
};

const MERIDIAN = {
  ink: '#141c17',
  ink2: '#1e2a22',
  paper: '#efe7d2',
  paperDim: '#e4dac0',
  moss: '#4a6e50',
  ochre: '#c9922f',
  brick: '#a23e32',
  muted: '#8fa08f',
  hair: '#3a4a3f',
  inkText: '#22201a',
  mutedOnPaper: '#5b6a5c',
  labelOnPaper: '#7a7156',
  dashed: '#b8ac8a',
  border: '#ddd0ae',
};


/** Map score (0–100) or letter grade → display grade, matching index.html gradeOf(). */
function gradeOf(scoreOrGrade) {
  if (scoreOrGrade == null || scoreOrGrade === '') {
    return { label: 'Unscored', code: '—', hex: MERIDIAN.muted };
  }
  if (typeof scoreOrGrade === 'string' && /^[A-F]$/i.test(scoreOrGrade)) {
    const code = scoreOrGrade.toUpperCase();
    const labels = {
      A: 'Strong Buy',
      B: 'Consider',
      C: 'Caution',
      D: 'Avoid',
      F: 'Avoid',
    };
    return { label: labels[code] || 'Unscored', code, hex: GRADE_COLORS[code] || MERIDIAN.muted };
  }
  const score = Number(scoreOrGrade);
  if (Number.isNaN(score)) return { label: 'Unscored', code: '—', hex: MERIDIAN.muted };
  if (score >= 80) return { label: 'Strong Buy', code: 'A', hex: GRADE_COLORS.A };
  if (score >= 65) return { label: 'Consider', code: 'B', hex: GRADE_COLORS.B };
  if (score >= 50) return { label: 'Caution', code: 'C', hex: GRADE_COLORS.C };
  return { label: 'Avoid', code: 'D', hex: GRADE_COLORS.D };
}

const SUBSCORE_LABELS = {
  buildability: 'Buildability',
  flood_risk: 'Flood / Water Risk',
  road_access: 'Road Access',
  utility_proximity: 'Utility Proximity',
  zoning_flexibility: 'Zoning Flexibility',
};

function StampSVG({ score, grade }) {
  const label = `${(grade.label + ' • GRADE ' + grade.code + ' • ').toUpperCase()}`.repeat(2);
  const uid = `cp-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg viewBox="0 0 120 120" width="108" height="108" style={{ flex: '0 0 108px' }}>
      <defs>
        <path id={uid} d="M 60,60 m -46,0 a 46,46 0 1,1 92,0 a 46,46 0 1,1 -92,0" fill="none" />
      </defs>
      <circle
        cx="60"
        cy="60"
        r="58"
        fill="none"
        stroke={grade.hex}
        strokeWidth="1"
        strokeDasharray="1 3"
        opacity="0.6"
      />
      <text
        fontFamily="IBM Plex Mono, monospace"
        fontSize="8.4"
        letterSpacing="2"
        fill={grade.hex}
      >
        <textPath href={`#${uid}`} startOffset="0">
          {label}
        </textPath>
      </text>
      <circle cx="60" cy="60" r="32" fill="none" stroke={grade.hex} strokeWidth="1.5" />
      <text
        x="60"
        y="67"
        textAnchor="middle"
        fontFamily="Fraunces, Georgia, serif"
        fontWeight="600"
        fontSize="26"
        fill={grade.hex}
      >
        {score != null && score !== '' ? score : '—'}
      </text>
    </svg>
  );
}

export function ParcelDetailDrawer({ selected, detailLoading, onClose }) {
  if (!selected || selected.kind !== 'parcel') return null;

  const score =
    selected.gradeScore != null
      ? selected.gradeScore
      : selected.score != null
        ? selected.score
        : null;
  const grade = gradeOf(selected.grade ?? score);

  const subKeys = [
    'buildability',
    'flood_risk',
    'road_access',
    'utility_proximity',
    'zoning_flexibility',
  ];
  const hasBreakdown = subKeys.some((k) => selected[k] != null);

  const name =
    selected.name ||
    `Parcel ${selected.propId || selected.id || 'Unknown'}`;
  const geoId = selected.geoId || selected.geo_id || selected.propId || selected.id;
  const zoning = selected.zoningDesc || selected.zoning_desc || selected.zoning || null;
  const acreage = selected.acreage != null ? Number(selected.acreage) : null;
  const marketValue =
    selected.marketValue != null
      ? selected.marketValue
      : selected.market_value != null
        ? selected.market_value
        : null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        height: '100%',
        width: 420,
        maxWidth: '100%',
        background: MERIDIAN.paper,
        color: MERIDIAN.inkText,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
        zIndex: 900,
        overflowY: 'auto',
        fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Head */}
      <div
        style={{
          padding: '20px 22px 14px',
          borderBottom: `1px dashed ${MERIDIAN.dashed}`,
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 26,
            height: 26,
            borderRadius: '50%',
            border: `1px solid ${MERIDIAN.dashed}`,
            background: 'transparent',
            cursor: 'pointer',
            color: MERIDIAN.mutedOnPaper,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
        <p
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: MERIDIAN.labelOnPaper,
            margin: '0 0 6px',
          }}
        >
          Parcel Dossier
        </p>
        <h2
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 23,
            fontWeight: 600,
            margin: '0 0 4px',
            lineHeight: 1.2,
            color: MERIDIAN.inkText,
            paddingRight: 28,
          }}
        >
          {name}
        </h2>
        <p
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11.5,
            color: MERIDIAN.mutedOnPaper,
            margin: 0,
          }}
        >
          {geoId}
          {acreage != null ? ` · ${acreage.toFixed(2)} ac` : ''}
          {selected.zoning ? ` · ${selected.zoning}` : ''}
        </p>
      </div>

      {selected.error && (
        <div style={{ padding: '16px 22px', color: MERIDIAN.brick, fontSize: 13 }}>
          Couldn&apos;t load details: {selected.error}
        </div>
      )}

      {detailLoading && !selected.error && (
        <div
          style={{
            padding: 24,
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            color: MERIDIAN.mutedOnPaper,
          }}
        >
          Loading parcel…
        </div>
      )}

      {!detailLoading && !selected.error && (
        <>
          {/* Stamp row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '16px 22px',
              borderBottom: `1px dashed ${MERIDIAN.dashed}`,
            }}
          >
            <StampSVG score={score} grade={grade} />
            <div>
              <p
                style={{
                  margin: '0 0 4px',
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 11,
                  color: MERIDIAN.mutedOnPaper,
                }}
              >
                Composite Land Score
              </p>
              <div
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 17,
                  fontWeight: 600,
                  color: grade.hex,
                }}
              >
                {grade.label}
              </div>
              {selected.monument_status && (
                <p
                  style={{
                    marginTop: 6,
                    marginBottom: 0,
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 11,
                    color: MERIDIAN.mutedOnPaper,
                  }}
                >
                  {selected.monument_status}
                </p>
              )}
            </div>
          </div>

          {/* Score breakdown (when factor scores exist) */}
          {hasBreakdown ? (
            <div
              style={{
                padding: '16px 22px',
                borderBottom: `1px solid ${MERIDIAN.border}`,
              }}
            >
              <h4
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: MERIDIAN.labelOnPaper,
                  margin: '0 0 12px',
                }}
              >
                Score Breakdown
              </h4>
              {subKeys.map((k) => {
                if (selected[k] == null) return null;
                const val = Number(selected[k]);
                return (
                  <div
                    key={k}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '120px 1fr 34px',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 9,
                    }}
                  >
                    <label style={{ fontSize: 12, margin: 0 }}>{SUBSCORE_LABELS[k] || k}</label>
                    <div
                      style={{
                        height: 6,
                        background: MERIDIAN.border,
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, Math.max(0, val))}%`,
                          background: grade.hex,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 11,
                        textAlign: 'right',
                        color: MERIDIAN.mutedOnPaper,
                      }}
                    >
                      {val}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Parcel facts */}
          <div
            style={{
              padding: '16px 22px',
              borderBottom: `1px solid ${MERIDIAN.border}`,
            }}
          >
            <h4
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: MERIDIAN.labelOnPaper,
                margin: '0 0 12px',
              }}
            >
              Parcel Facts
            </h4>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px 14px',
              }}
            >
              <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5 }}>
                <b
                  style={{
                    display: 'block',
                    fontFamily: '"IBM Plex Sans", sans-serif',
                    fontSize: 10,
                    color: MERIDIAN.labelOnPaper,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 2,
                  }}
                >
                  Acreage
                </b>
                {acreage != null ? `${acreage.toFixed(2)} ac` : '—'}
              </div>
              <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5 }}>
                <b
                  style={{
                    display: 'block',
                    fontFamily: '"IBM Plex Sans", sans-serif',
                    fontSize: 10,
                    color: MERIDIAN.labelOnPaper,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 2,
                  }}
                >
                  Zoning
                </b>
                {zoning || selected.zoning || '—'}
              </div>
              <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5 }}>
                <b
                  style={{
                    display: 'block',
                    fontFamily: '"IBM Plex Sans", sans-serif',
                    fontSize: 10,
                    color: MERIDIAN.labelOnPaper,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 2,
                  }}
                >
                  Market Value
                </b>
                {marketValue != null
                  ? `$${Number(marketValue).toLocaleString()}`
                  : '—'}
              </div>
              <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5 }}>
                <b
                  style={{
                    display: 'block',
                    fontFamily: '"IBM Plex Sans", sans-serif',
                    fontSize: 10,
                    color: MERIDIAN.labelOnPaper,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 2,
                  }}
                >
                  Composite Score
                </b>
                {score != null ? `${score} / 100` : '—'}
              </div>
              {selected.subdivisionName && (
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 11.5,
                    gridColumn: '1 / -1',
                  }}
                >
                  <b
                    style={{
                      display: 'block',
                      fontFamily: '"IBM Plex Sans", sans-serif',
                      fontSize: 10,
                      color: MERIDIAN.labelOnPaper,
                      fontWeight: 500,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 2,
                    }}
                  >
                    Subdivision
                  </b>
                  {selected.subdivisionName}
                </div>
              )}
            </div>
          </div>

          {/* Why this grade / reasons from page.js detail API */}
          {selected.gradeReasons?.length > 0 && (
            <div
              style={{
                padding: '16px 22px',
                borderBottom: `1px solid ${MERIDIAN.border}`,
              }}
            >
              <h4
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: MERIDIAN.labelOnPaper,
                  margin: '0 0 12px',
                }}
              >
                Why this grade
              </h4>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  color: '#37342a',
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {selected.gradeReasons.map((reason, i) => (
                  <li key={i} style={{ marginTop: i === 0 ? 0 : 4 }}>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes */}
          {selected.notes && (
            <div
              style={{
                padding: '16px 22px',
                borderBottom: `1px solid ${MERIDIAN.border}`,
              }}
            >
              <h4
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: MERIDIAN.labelOnPaper,
                  margin: '0 0 12px',
                }}
              >
                Surveyor&apos;s Notes
              </h4>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: '#37342a',
                  margin: 0,
                }}
              >
                {selected.notes}
              </p>
            </div>
          )}

          {/* Flags */}
          {selected.flags?.length > 0 && (
            <div style={{ padding: '12px 22px 0' }}>
              {selected.flags.map((f, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 11.5,
                    color: MERIDIAN.brick,
                    display: 'flex',
                    gap: 6,
                    marginBottom: 5,
                  }}
                >
                  <span>⚑</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              padding: '18px 22px',
              display: 'flex',
              gap: 10,
              marginTop: 'auto',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                background: MERIDIAN.moss,
                color: '#fff',
                border: 'none',
                padding: '11px 12px',
                borderRadius: 3,
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 11.5,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}