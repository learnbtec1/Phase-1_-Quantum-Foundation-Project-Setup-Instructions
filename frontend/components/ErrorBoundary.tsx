'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  resetKeys?: unknown[];
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary]', error, info);
    }
  }

  componentDidUpdate(prevProps: Props) {
    const keysChanged =
      this.props.resetKeys &&
      (prevProps.resetKeys?.length !== this.props.resetKeys.length ||
        this.props.resetKeys.some((k, i) => prevProps.resetKeys?.[i] !== k));
    if (this.state.hasError && keysChanged) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-400 text-sm p-4">
            حدث خطأ غير متوقع. يرجى إعادة تحميل الصفحة.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
