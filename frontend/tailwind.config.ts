import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}", // التأكد من شمول مجلد app
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}", // التأكد من شمول المكونات الجديدة
    "./app/globals.css", // Include the globals.css file
  ],
  theme: {
    extend: {
      colors: {
        // الألوان الأساسية القائمة على المتغيرات
        primary: "rgb(var(--primary) / <alpha-value>)",
        secondary: "rgb(var(--secondary) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        glass: "rgb(var(--glass-bg) / <alpha-value>)",
        "glass-border": "rgb(var(--glass-border) / <alpha-value>)",
        
        // 👇 الألوان المطلوبة لمنصة Nexus (رؤية 2046)
        midnight: "#020617", // لون الفضاء العميق
        cyan: {
          DEFAULT: "#06b6d4",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
        emerald: {
          DEFAULT: "#10b981",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
      },
      
      fontFamily: {
        sans: ['var(--font-cairo)', 'var(--font-inter)', 'sans-serif'],
        cairo: ['var(--font-cairo)'],
        inter: ['var(--font-inter)'],
      },

      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'spin-slow': 'spin 20s linear infinite',
        'bounce-slow': 'bounce 3s infinite',
        'fade-in': 'fadeIn 0.5s ease-in',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        // إضافة أنيميشن النيون للبطاقات
        'border-glow': 'border-glow 3s linear infinite',
        'gridShift': 'gridShift 8s linear infinite',
      },
      
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 20px rgba(6, 182, 212, 0.5)' },
          '50%': { opacity: '0.8', boxShadow: '0 0 40px rgba(6, 182, 212, 0.8)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        'border-glow': {
          '0%, 100%': { borderColor: '#06b6d4' },
          '50%': { borderColor: '#10b981' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        gridShift: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '48px 48px' },
        },
      },

      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'gradient-nexus': 'linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(139,92,246,0.2) 50%, rgba(236,72,153,0.2) 100%)',
        'gradient-market': 'linear-gradient(135deg, #00f3ff 0%, #b967ff 50%, #ff6b35 100%)',
      },

      backdropBlur: {
        'xs': '2px',
        'sm': '4px',
        'xl': '20px', // إضافة Blur عالٍ لتأثير الـ Hyper-Glassmorphism
      },

      boxShadow: {
        'nexus': '0 0 50px rgba(6, 182, 212, 0.2)',
        'nexus-bright': '0 0 30px rgba(6, 182, 212, 0.5)',
        'emerald-glow': '0 0 30px rgba(16, 185, 129, 0.4)',
        'market': '0 0 40px rgba(139, 92, 246, 0.3)',
        'district': '0 10px 40px rgba(0, 0, 0, 0.5)',
      },

      screens: {
        'xs': '475px',
        '3xl': '1920px',
      },
    },
  },
  plugins: [],
};

export default config;