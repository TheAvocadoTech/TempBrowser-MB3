import React from 'react';
import { Map, Box } from 'lucide-react';

export default function Header({ viewMode = '2D', onViewModeChange }) {
  return (
    <header className="header-container">
      {/* Brand Logo Header */}
      <div className="header-brand-group">
        {/* Thick Red Vertical Accent Line */}
        <div className="red-accent-bar"></div>

        {/* Brand Logo Image */}
        <div className="logo-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
          <img
            src="/equi.png"
            alt="Equi Brand Logo"
            style={{ height: '32px', width: 'auto', objectFit: 'contain' }}
          />
        </div>
      </div>

      {/* 2D / 3D Mode Switcher */}
      {onViewModeChange && (
        <div className="view-mode-switcher">
          <button
            type="button"
            className={`view-mode-btn ${viewMode === '2D' ? 'active' : ''}`}
            onClick={() => onViewModeChange('2D')}
            id="btn-viewmode-2d"
          >
            <Map size={14} />
            2D Map
          </button>
          <button
            type="button"
            className={`view-mode-btn ${viewMode === '3D' ? 'active' : ''}`}
            onClick={() => onViewModeChange('3D')}
            id="btn-viewmode-3d"
          >
            <Box size={14} />
            3D Map
          </button>
        </div>
      )}
    </header>
  );
}
