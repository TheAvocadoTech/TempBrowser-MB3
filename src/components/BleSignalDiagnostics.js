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

const BleSignalDiagnostics = ({ rssi, beam, ap_mac, last_seen, x, y, x_m, y_m }) => {
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
        <span className={`ble-diag-quality-pill ble-diag-quality-pill--${quality.color}`}>
          {quality.emoji} {quality.label}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="ble-diag-grid">
        {/* Live Coordinates (Pixels) */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">Live Coords (px)</span>
          <span className="ble-diag-metric-value ble-diag-metric-value--mono">
            {formattedCoordsPx}
          </span>
        </div>

        {/* Live Position (Meters) */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">Position (m)</span>
          <span className="ble-diag-metric-value ble-diag-metric-value--mono">
            {formattedCoordsM || "--"}
          </span>
        </div>

        {/* RSSI */}
        <div className="ble-diag-metric">
          <span className="ble-diag-metric-label">RSSI</span>
          <span className={`ble-diag-metric-value ble-diag-metric-value--${quality.color}`}>
            {isNoData ? "--" : `${rssi} dBm`}
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
            Weak BLE signal. Position may jump due to poor signal quality.
          </span>
        </div>
      )}
    </div>
  );
};

export default BleSignalDiagnostics;
