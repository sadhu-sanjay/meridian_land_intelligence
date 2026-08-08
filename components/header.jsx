export default function Header() {
  const styles = {
    topbar: {
      height: "58px",
      flex: "0 0 58px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 18px",
      background: "var(--ink)",
      borderBottom: "1px solid var(--hair)",
    },
    topbarRight: {
      display: "flex",
      alignItems: "center",
      gap: "14px",
    },
    brand: {
      display: "flex",
      alignItems: "baseline",
      gap: "10px",
    },
    mark: {
      width: "26px",
      height: "26px",
      border: "1.4px solid var(--ochre)",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      color: "var(--ochre)",
      flex: "0 0 26px",
    },
    brandTitle: {
      fontFamily: "var(--font-display)",
      fontWeight: 600,
      fontSize: "19px",
      letterSpacing: "0.02em",
      margin: 0,
      color: "var(--paper)",
    },
    tag: {
      fontFamily: "var(--font-mono)",
      fontSize: "10.5px",
      color: "var(--muted)",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      paddingLeft: "10px",
      borderLeft: "1px solid var(--hair)",
      marginLeft: "2px",
    },
    locus: {
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      color: "var(--muted)",
    },
    demoPill: {
      fontFamily: "var(--font-mono)",
      fontSize: "10px",
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "var(--ink)",
      background: "var(--ochre)",
      padding: "4px 9px",
      borderRadius: "2px",
      fontWeight: 500,
    },
  };

  return (
    <header style={styles.topbar}>
      <div style={styles.brand}>
        <div style={styles.mark}>M</div>
        <h1 style={styles.brandTitle}>Meridian</h1>
        <span style={styles.tag}>Land Intelligence</span>
      </div>

      <div style={styles.topbarRight}>
        <span style={styles.locus}>
          Whatcom County, WA — Chuckanut / Samish Corridor
        </span>
        <span style={styles.demoPill}>Demo · Sample Dataset</span>
      </div>
    </header>
  );
}