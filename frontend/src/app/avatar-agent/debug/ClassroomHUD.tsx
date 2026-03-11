'use client';
/**
 * ClassroomHUD.tsx — DOM overlay for the classroom scene.
 *
 * Renders OUTSIDE the R3F Canvas — receives pre-computed data as props.
 * (useThree() cannot be called outside a Canvas; scene polling is done by
 * the DeskAnchorTracker bridge component inside SceneClassroom.)
 *
 * Props:
 *   onTogglePhysics   — toggle Rapier physics on/off
 *   onToggleHDRI      — toggle HDRI environment on/off
 *   isPhysicsEnabled  — current physics state
 *   isHDRIEnabled     — current HDRI state
 *   deskAnchorPos     — formatted world-position string, e.g. "X:0.00 Y:0.00 Z:0.90"
 */
import React from 'react';

interface ClassroomHUDProps {
  onTogglePhysics:  () => void;
  onToggleHDRI:     () => void;
  isPhysicsEnabled: boolean;
  isHDRIEnabled:    boolean;
  deskAnchorPos:    string;
}

const ClassroomHUD: React.FC<ClassroomHUDProps> = ({
  onTogglePhysics,
  onToggleHDRI,
  isPhysicsEnabled,
  isHDRIEnabled,
  deskAnchorPos,
}) => {
  return (
    <div
      style={{
        position:   'absolute',
        top:        10,
        left:       10,
        background: 'rgba(0,0,0,0.55)',
        color:      '#e8e8e8',
        padding:    '10px 14px',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize:   12,
        lineHeight: '1.8em',
        zIndex:     1000,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      <div>
        Physics:{' '}
        <button
          onClick={onTogglePhysics}
          style={btnStyle(isPhysicsEnabled)}
        >
          {isPhysicsEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div>
        HDRI:{' '}
        <button
          onClick={onToggleHDRI}
          style={btnStyle(isHDRIEnabled)}
        >
          {isHDRIEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div style={{ marginTop: 4 }}>
        DeskAnchor: <span style={{ color: '#8bc8ff' }}>{deskAnchorPos}</span>
      </div>
    </div>
  );
};

function btnStyle(active: boolean): React.CSSProperties {
  return {
    marginLeft:      6,
    padding:         '1px 8px',
    borderRadius:    4,
    border:          'none',
    cursor:          'pointer',
    fontSize:        11,
    fontFamily:      'monospace',
    background:      active ? '#2d7d46' : '#7d2d2d',
    color:           '#fff',
  };
}

export default ClassroomHUD;
