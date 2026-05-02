import React from "react";

export const StudentAvatar: React.FC<{ isAnimating?: boolean }> = ({
  isAnimating = true,
}) => {
  return (
    <div
      className="h-full w-full animate-float-slow drop-shadow-[0_0_10px_rgba(99,102,241,0.3)]"
      aria-hidden
    >
    <svg
      viewBox="0 0 180 220"
      className="h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="skinGradient2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fdbcb4" />
          <stop offset="100%" stopColor="#f5a89f" />
        </linearGradient>
        <linearGradient id="laptopGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e5e7eb" />
          <stop offset="100%" stopColor="#d1d5db" />
        </linearGradient>
        <filter id="shadow2" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="3"
            floodOpacity="0.3"
          />
        </filter>
      </defs>

      {/* Laptop Base */}
      <g className={isAnimating ? "" : ""}>
        <rect
          x="20"
          y="120"
          width="140"
          height="8"
          rx="4"
          fill="#374151"
          filter="url(#shadow2)"
        />
        <path
          d="M 30 128 L 150 128 L 148 180 Q 90 185 32 180 Z"
          fill="url(#laptopGradient)"
          filter="url(#shadow2)"
        />
        {/* Screen */}
        <rect x="35" y="95" width="110" height="30" rx="2" fill="#060b27" />
        {/* Screen Glow - animated */}
        <rect
          x="35"
          y="95"
          width="110"
          height="30"
          rx="2"
          fill="#3b82f6"
          opacity="0.2"
          className={isAnimating ? "animate-glow" : ""}
        />
      </g>

      {/* Body/Shirt */}
      <path
        d="M 50 70 Q 50 60 60 60 L 120 60 Q 130 60 130 70 L 130 120 Q 130 130 120 130 L 60 130 Q 50 130 50 120 Z"
        fill="#10b981"
        filter="url(#shadow2)"
      />

      {/* Neck */}
      <rect
        x="75"
        y="55"
        width="30"
        height="12"
        fill="url(#skinGradient2)"
        filter="url(#shadow2)"
      />

      {/* Head */}
      <circle
        cx="90"
        cy="40"
        r="26"
        fill="url(#skinGradient2)"
        filter="url(#shadow2)"
      />

      {/* Hair */}
      <path
        d="M 65 28 Q 90 12 115 28 Q 115 38 110 42 Q 90 48 70 42 Q 65 38 65 28 Z"
        fill="#8b5a3c"
        filter="url(#shadow2)"
      />

      {/* Left Eye - looking at screen */}
      <circle cx="78" cy="36" r="3" fill="#1a1a1a" />
      <circle cx="80" cy="34" r="1.2" fill="#ffffff" opacity="0.9" />

      {/* Right Eye - looking at screen */}
      <circle cx="102" cy="36" r="3" fill="#1a1a1a" />
      <circle cx="104" cy="34" r="1.2" fill="#ffffff" opacity="0.9" />

      {/* Eyebrows - engaged expression */}
      <path d="M 73 31 Q 78 29 83 31" stroke="#8b5a3c" strokeWidth="1.2" fill="none" />
      <path d="M 97 31 Q 102 29 107 31" stroke="#8b5a3c" strokeWidth="1.2" fill="none" />

      {/* Nose */}
      <path d="M 90 36 L 90 44" stroke="#e8b89f" strokeWidth="1.2" fill="none" />

      {/* Happy smile - engaged */}
      <path
        d="M 80 48 Q 90 54 100 48"
        stroke="#d9876b"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        className={isAnimating ? "animate-pulse" : ""}
      />

      {/* Left Arm - typing */}
      <g className={isAnimating ? "animate-[swing_1.5s_ease-in-out_infinite]" : ""}>
        <rect x="40" y="75" width="10" height="40" rx="5" fill="url(#skinGradient2)" />
        <circle cx="45" cy="120" r="5" fill="url(#skinGradient2)" />
      </g>

      {/* Right Arm - typing */}
      <g
        className={isAnimating ? "animate-[swing_1.5s_ease-in-out_0.3s_infinite]" : ""}
        style={{ transformOrigin: "130px 75px" }}
      >
        <rect x="130" y="75" width="10" height="40" rx="5" fill="url(#skinGradient2)" />
        <circle cx="135" cy="120" r="5" fill="url(#skinGradient2)" />
      </g>

      {/* Keyboard */}
      <rect x="45" y="125" width="90" height="8" rx="1" fill="#1f2937" />
      <g opacity="0.6">
        <circle cx="55" cy="129" r="1.5" fill="#e5e7eb" />
        <circle cx="65" cy="129" r="1.5" fill="#e5e7eb" />
        <circle cx="75" cy="129" r="1.5" fill="#e5e7eb" />
        <circle cx="85" cy="129" r="1.5" fill="#e5e7eb" />
        <circle cx="95" cy="129" r="1.5" fill="#e5e7eb" />
        <circle cx="110" cy="129" r="1.5" fill="#e5e7eb" />
        <circle cx="125" cy="129" r="1.5" fill="#e5e7eb" />
      </g>

      {/* Engagement indicator - animated */}
      {isAnimating && (
        <>
          <circle
            cx="140"
            cy="25"
            r="2.5"
            fill="#ec4899"
            className="animate-float"
            opacity="0.8"
          />
          <circle
            cx="155"
            cy="35"
            r="2"
            fill="#ec4899"
            className="animate-[float_3s_ease-in-out_0.4s_infinite]"
            opacity="0.6"
          />
          <circle
            cx="130"
            cy="50"
            r="1.5"
            fill="#ec4899"
            className="animate-[float_3s_ease-in-out_0.8s_infinite]"
            opacity="0.7"
          />
        </>
      )}
    </svg>
    </div>
  );
};

export default StudentAvatar;
