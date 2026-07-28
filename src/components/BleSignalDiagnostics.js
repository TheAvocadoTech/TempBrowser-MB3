import React from "react";

/**
 * BleSignalDiagnostics
 * ---------------------
 * Displays real-time BLE signal quality diagnostics for the tracked tag:
 *  - RSSI (dBm) with colour-coded quality label
 *  - Antenna beam index
 *  - AP MAC address
 *  - Last seen timestamp
 *  - Warning banner when signal is weak (< -75 dBm)
 *
 * Props:
 *   rssi      {number|null}  e.g. -72
 *   beam      {number|null}  e.g. 3
 *   ap_mac    {string|null}  e.g. "c878678a984c"
 *   last_seen {string|null}  ISO timestamp
 */

// Classify RSSI into quality tiers
function getSignalQuality(rssi) {
  if (rssi === null || rssi === undefined) return { label: "No Data", color: "grey", emoji: "⚪" };
  if (rssi >= -55) return { label: "Excellent", color: "green", emoji: "🟢" };
  if (rssi >= -65) return { label: "Good", color: "green", emoji: "🟢" };
  if (rssi >= -75) return { label: "Fair", color: "yellow", emoji: "🟡" };
  return { label: "Poor", color: "red", emoji: "🔴" };
}

// Format last_seen timestamp as a human-readable "X sec ago" string
function formatLastSeen(last_seen) {
  if (!last_seen) return "--";
  const diff = Math.round((Date.now() - new Date(last_seen * 1000).getTime()) / 1000);
  if (isNaN(diff) || diff < 0) return "--";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const BleSignalDiagnostics = ({
  rssi,
  rawRssi,
  beam,
  ap_mac,
  last_seen,
  x,
  y,
  x_m,
  y_m,
  queueSize = 0,
  queueCapacity = 25,
  rssiThreshold = -60,
}) => {
  const quality = getSignalQuality(rssi);
  const isWeak = rssi !== null && rssi < -75;
  const isNoData = rssi === null || rssi === undefined;

  const formattedCoordsPx =
    x !== null && x !== undefined && y !== null && y !== undefined
      ? `(${Number(x).toFixed(1)}, ${Number(y).toFixed(1)})`
      : "--";

  const formattedCoordsM =
    x_m !== null && x_m !== undefined && y_m !== null && y_m !== undefined
      ? `(${Number(x_m).toFixed(2)}m, ${Number(y_m).toFixed(2)}m)`
      : null;

  return (
    <div className={`ble-diag-card ${isWeak ? "ble-diag-card--weak" : ""}`}>
      {/* Header row */}
      <div className="ble-diag-header">
        <div className="ble-diag-title-group">
          {/* Animated pulse dot — green if good, amber if fair, red if poor */}
          <span className={`ble-diag-dot ble-diag-dot--${quality.color}`} />
          <span className="ble-diag-title">BLE Signal & Live Diagnostics</span>
        </div>
        <div className="ble-diag-header-pills" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span className="ble-diag-quality-pill" style={{ background: "#1e1b4b", color: "#a5b4fc", border: "1px solid #3730a3" }}>
            🎯 Cutoff: &gt; {rssiThreshold} dBm
          </span>
          {queueCapacity > 0 && (
            <span className="ble-diag-quality-pill" style={{ background: "#1e293b", color: "#38bdf8", border: "1px solid #334155" }}>
              ⚡ Buffer: {queueSize}/{queueCapacity}
            </span>
          )}
          <span className={`ble-diag-quality-pill ble-diag-quality-pill--${quality.color}`}>
            {quality.emoji} {quality.label}
          </span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="ble-diag-grid">
        {/* Live Coordinates (Pixels - Smoothed Mean) */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">Smoothed Coords (px)</span>
          <span className="ble-diag-metric-value ble-diag-metric-value--mono">
            {formattedCoordsPx}
          </span>
        </div>

        {/* Live Position (Meters - Smoothed Mean) */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">Smoothed Position (m)</span>
          <span className="ble-diag-metric-value ble-diag-metric-value--mono">
            {formattedCoordsM || "--"}
          </span>
        </div>

        {/* RSSI (Smoothed Average) */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">Avg RSSI</span>
          <span className={`ble-diag-metric-value ble-diag-metric-value--${quality.color}`}>
            {isNoData ? "--" : `${rssi} dBm`}
            {rawRssi !== null && rawRssi !== undefined && rawRssi !== rssi && (
              <span style={{ fontSize: "0.75rem", opacity: 0.7, marginLeft: "4px" }}>
                (Raw: {rawRssi})
              </span>
            )}
          </span>
        </div>

        {/* Beam */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">Beam Index</span>
          <span className="ble-diag-metric-value">
            {beam !== null && beam !== undefined ? beam : "--"}
          </span>
        </div>

        {/* AP MAC */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">AP MAC</span>
          <span className="ble-diag-metric-value ble-diag-metric-value--mono">
            {ap_mac || "--"}
          </span>
        </div>

        {/* Last Seen */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">Last Seen</span>
          <span className="ble-diag-metric-value">{formatLastSeen(last_seen)}</span>
        </div>
      </div>

      {/* Weak signal warning */}
      {isWeak && (
        <div className="ble-diag-warning">
          <span className="ble-diag-warning-icon">⚠️</span>
          <span className="ble-diag-warning-text">
            Weak BLE signal. Moving average window actively filtering signal noise.
          </span>
        </div>
      )}
    </div>
  );
};

export default BleSignalDiagnostics;
