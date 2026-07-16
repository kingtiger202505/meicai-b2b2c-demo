import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text } from '@tarojs/components';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <View style={{ padding: '30px', background: '#fff', color: 'red', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, overflow: 'auto' }}>
          <Text style={{ fontSize: '20px', fontWeight: 'bold', display: 'block', marginBottom: '15px' }}>
            小程序异常崩盘:
          </Text>
          <Text style={{ fontSize: '14px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>
            {this.state.error?.stack || this.state.error?.message || '未知错误'}
          </Text>
        </View>
      );
    }

    return this.children;
  }
}
