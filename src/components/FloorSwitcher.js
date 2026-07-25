import React from 'react';
//
const FloorSwitcher = ({ activeFloor, onFloorChange }) => {
  return (
    <div className="floor-toolbar">
      <button
        className={`floor-btn ${activeFloor === 'GR' ? 'active' : ''}`}
        onClick={() => onFloorChange('GR')}
        type="button"
        id="btn-floor-gr"
      >
        <span>GR</span>
        <span className="floor-badge">Ground</span>
      </button>
      <button
        className={`floor-btn ${activeFloor === 'F1' ? 'active' : ''}`}
        onClick={() => onFloorChange('F1')}
        type="button"
        id="btn-floor-f1"
      >
        <span>F1</span>
        <span className="floor-badge">1st Floor</span>
      </button>
    </div>
  );
};

export default FloorSwitcher;
