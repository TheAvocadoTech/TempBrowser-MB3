import React from 'react';

export default function CommonButton({ onClick }) {
  return (
    <div className="bottom-nav-container">
      <button
        onClick={onClick || (() => console.log('Common action triggered'))}
        className="common-btn"
        id="btn-common-action"
        type="button"
      >
        common
      </button>
    </div>
  );
}
