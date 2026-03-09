'use client';

import React, { useState } from 'react';

type Props = {
  label?: string;
};

const DrHamzaOrb: React.FC<Props> = ({ label = 'Dr. Hamza' }) => {
  const [isActive, setIsActive] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const toggleActive = () => {
    setIsActive((prev) => !prev);
  };

  return (
    <div
      data-testid="avatar-orb"
      data-active={isActive ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label="Dr Hamza interactive avatar"
      aria-pressed={isActive ? 'true' : 'false'}
      onClick={toggleActive}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleActive();
        }
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      title="انقر للتفاعل"
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: 100,
        height: 100,
        borderRadius: '50%',
        background: isActive
          ? 'radial-gradient(circle, #67e8f9, #0284c7)'
          : 'radial-gradient(circle, #ffaa00, #ff5500)',
        boxShadow: isActive
          ? '0 0 26px #22d3ee'
          : '0 0 20px #ffaa00',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
        zIndex: 9999,
        cursor: 'pointer',
        userSelect: 'none',
        transform: isHovering || isActive ? 'scale(1.06)' : 'scale(1)',
        transition: 'transform 150ms ease, box-shadow 150ms ease, background 150ms ease',
      }}
    >
      {isActive ? 'متفاعل' : label}
    </div>
  );
};

export default DrHamzaOrb;