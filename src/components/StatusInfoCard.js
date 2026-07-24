import React from 'react';
import { LIFT_COORDINATES } from '../constants';

const StatusInfoCard = ({ floor, visitorInfo, bleLocation, targetCoordinates, distance }) => {
  const targetLabel = floor === 'GR' 
    ? LIFT_COORDINATES.label 
    : (targetCoordinates?.name || "Backend Cabinet Destination");

  const targetCoordsText = floor === 'GR'
    ? `(${LIFT_COORDINATES.x.toFixed(1)}, ${LIFT_COORDINATES.y.toFixed(1)})`
    : targetCoordinates?.x && targetCoordinates?.y
      ? `(${targetCoordinates.x.toFixed(1)}, ${targetCoordinates.y.toFixed(1)})`
      : "Pending API Data";

  const tagId = bleLocation?.name || visitorInfo?.idNumber || "Tracking BLE Tag...";
  const formattedDistance = distance !== null && distance !== undefined
    ? `${Math.round(distance)} units`
    : "--";

  return (
    <div className="status-card-floating">
      <div className="status-header-row">
        <div className="status-title-group">
          <span className="status-indicator-dot"></span>
          <span className="status-title-text">
            {floor === 'GR' ? 'GR Navigation: Target = Lift' : 'F1 Navigation: Target = Backend Destination'}
          </span>
        </div>
        <span className="status-pill">{floor} Floor</span>
      </div>

      <div className="status-details-grid">
        <div className="status-metric">
          <span className="status-metric-label">BLE Tag Asset</span>
          <span className="status-metric-value">{tagId}</span>
        </div>
        <div className="status-metric">
          <span className="status-metric-label">Destination</span>
          <span className="status-metric-value">{targetLabel}</span>
        </div>
        <div className="status-metric">
          <span className="status-metric-label">Coordinates</span>
          <span className="status-metric-value">{targetCoordsText}</span>
        </div>
        <div className="status-metric">
          <span className="status-metric-label">Distance</span>
          <span className="status-metric-value">{formattedDistance}</span>
        </div>
      </div>
    </div>
  );
};

export default StatusInfoCard;
