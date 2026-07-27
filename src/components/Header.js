import React from 'react';

export default function Header() {
  return (
    <header className="header-container">
      {/* Brand Logo Header */}
      <div className="header-brand-group">
        {/* Thick Red Vertical Accent Line */}
        <div className="red-accent-bar"></div>

        {/* Brand Logo Image replacing text */}
        <div className="logo-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
          <img
            src="/equi.png"
            alt="Equi Brand Logo"
            style={{ height: '32px', width: 'auto', objectFit: 'contain' }}
          />
        </div>
      </div>
    </header>
  );
}
