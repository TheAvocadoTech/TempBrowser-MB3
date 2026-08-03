// Inside StatusInfoCard component, after the distance metric:
<div className="status-metric">
  <span className="status-metric-label">Nearby Assets</span>
  <span className="status-metric-value">
    {assets ? assets.filter((a) => a.map_id === floorMapId).length : 0}
  </span>
</div>;
