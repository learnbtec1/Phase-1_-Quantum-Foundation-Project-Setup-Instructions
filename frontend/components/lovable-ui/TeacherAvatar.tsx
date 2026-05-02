import React from "react";

export const TeacherAvatar: React.FC<{ isAnimating?: boolean }> = ({
  isAnimating = true,
}) => {
  return (
    <div
      className="h-full w-full animate-float-slow drop-shadow-[0_0_10px_rgba(99,102,241,0.3)]"
      aria-hidden
    >
    <svg
      viewBox="0 0 200 240"
      className="h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Define gradients */}
      <defs>
        <linearGradient id="skinGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f4c4a0" />
          <stop offset="100%" stopColor="#e8b895" />
        </linearGradient>
        <linearGradient id="shirtGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1e40af" />
        </linearGradient>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="3"
            floodOpacity="0.3"
          />
        </filter>
      </defs>

      {/* Body/Shirt */}
      <path
        d="M 60 80 Q 60 70 70 70 L 130 70 Q 140 70 140 80 L 140 140 Q 140 150 130 150 L 70 150 Q 60 150 60 140 Z"
        fill="url(#shirtGradient)"
        filter="url(#shadow)"
      />

      {/* Neck */}
      <rect
        x="85"
        y="65"
        width="30"
        height="15"
        fill="url(#skinGradient)"
        filter="url(#shadow)"
      />

      {/* Head */}
      <circle
        cx="100"
        cy="50"
        r="30"
        fill="url(#skinGradient)"
        filter="url(#shadow)"
      />

      {/* Hair */}
      <path
        d="M 70 35 Q 100 15 130 35 Q 130 45 125 50 Q 100 55 75 50 Q 70 45 70 35 Z"
        fill="#3d2817"
        filter="url(#shadow)"
      />

      {/* Left Eye */}
      <circle cx="85" cy="45" r="3.5" fill="#1a1a1a" />
      <circle cx="87" cy="43" r="1.5" fill="#ffffff" opacity="0.8" />

      {/* Right Eye */}
      <circle cx="115" cy="45" r="3.5" fill="#1a1a1a" />
      <circle cx="117" cy="43" r="1.5" fill="#ffffff" opacity="0.8" />

      {/* Eyebrows */}
      <path d="M 80 40 Q 85 38 90 40" stroke="#3d2817" strokeWidth="1.5" fill="none" />
      <path d="M 110 40 Q 115 38 120 40" stroke="#3d2817" strokeWidth="1.5" fill="none" />

      {/* Nose */}
      <path d="M 100 45 L 100 55" stroke="#d4a574" strokeWidth="1.5" fill="none" />

      {/* Smile - animated */}
      <path
        d="M 88 58 Q 100 65 112 58"
        stroke="#c97560"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        className={isAnimating ? "animate-pulse" : ""}
      />

      {/* Left Arm */}
      <g className={isAnimating ? "animate-[swing_2s_ease-in-out_infinite]" : ""}>
        <rect x="50" y="85" width="12" height="45" rx="6" fill="url(#skinGradient)" />
        <circle cx="56" cy="135" r="6" fill="url(#skinGradient)" />
      </g>

      {/* Right Arm - holding tablet/device */}
      <g className={isAnimating ? "animate-[wave_2s_ease-in-out_infinite]" : ""}>
        <rect x="138" y="85" width="12" height="45" rx="6" fill="url(#skinGradient)" />
        <circle cx="144" cy="135" r="6" fill="url(#skinGradient)" />
        {/* Tablet/Device */}
        <rect x="130" y="100" width="35" height="50" rx="4" fill="#e5e7eb" stroke="#3b82f6" strokeWidth="2" />
        <rect x="133" y="103" width="29" height="41" rx="2" fill="#f0f9ff" />
        {/* Tablet content - simple lines representing content */}
        <line x1="138" y1="110" x2="158" y2="110" stroke="#3b82f6" strokeWidth="1" opacity="0.6" />
        <line x1="138" y1="116" x2="158" y2="116" stroke="#3b82f6" strokeWidth="1" opacity="0.6" />
        <line x1="138" y1="122" x2="155" y2="122" stroke="#3b82f6" strokeWidth="1" opacity="0.6" />
        <circle cx="148" cy="130" r="3" fill="#3b82f6" opacity="0.7" />
        <circle cx="140" cy="130" r="3" fill="#3b82f6" opacity="0.7" />
      </g>

      {/* Body detail - pocket */}
      <rect x="88" y="100" width="24" height="20" rx="2" fill="rgba(30, 64, 175, 0.3)" />

      {/* Thinking/Teaching indicator - animated sparkles */}
      {isAnimating && (
        <>
          <circle
            cx="135"
            cy="30"
            r="2"
            fill="#fbbf24"
            className="animate-[pulse_1.5s_ease-in-out_infinite]"
            opacity="0.8"
          />
          <circle
            cx="145"
            cy="40"
            r="1.5"
            fill="#fbbf24"
            className="animate-[pulse_1.5s_ease-in-out_0.3s_infinite]"
            opacity="0.6"
          />
          <circle
            cx="125"
            cy="50"
            r="1"
            fill="#fbbf24"
            className="animate-[pulse_1.5s_ease-in-out_0.6s_infinite]"
            opacity="0.7"
          />
        </>
      )}
    </svg>
    </div>
  );
};

export default TeacherAvatar;
