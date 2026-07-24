import React from 'react';

export default function Header() {
  return (
    <header className="header-container">
      {/* Brand Logo Header */}
      <div className="header-brand-group">
        {/* Thick Red Vertical Accent Line */}
        <div className="red-accent-bar"></div>

        {/* Brand Text */}
        <div className="logo-wrapper">
          <div className="brand-text-group">
            <span className="brand-title">AVOCADO</span>
            <span className="brand-subtitle">From seed to screen</span>
          </div>
        </div>
      </div>
    </header>
  );
}
