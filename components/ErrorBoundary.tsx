"use client";
import React from 'react';

type Props = { children: React.ReactNode };

export default class ErrorBoundary extends React.Component<Props, { hasError: boolean; error?: Error }>{
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    // Log to console and optionally send to a monitoring endpoint
    // Keep minimal to avoid adding new dependencies here.
    // eslint-disable-next-line no-console
    console.error('Uncaught error in app:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding:32,display:'flex',flexDirection:'column',gap:12,alignItems:'center',justifyContent:'center',minHeight:'100vh'}}>
          <h2>خطأ في واجهة التطبيق</h2>
          <p>حصل خطأ غير متوقع — نحاول حماية تجربتك. أعد تحميل الصفحة أو تواصل مع الدعم.</p>
          <button onClick={() => location.reload()} style={{padding:'8px 16px',borderRadius:6}}>إعادة تحميل</button>
        </div>
      );
    }

    return this.props.children as React.ReactElement;
  }
}
