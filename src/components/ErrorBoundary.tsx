import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught report:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          background: 'var(--bg-deep)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-primary)',
          textAlign: 'center'
        }}>
          <AlertCircle size={48} color="var(--red)" style={{ marginBottom: 24 }} />
          <h1 className="font-cinzel" style={{ fontSize: 24, fontWeight: 900, marginBottom: 16 }}>
            SYSTEM RENDER EXCEPTION
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 500, lineHeight: 1.6, marginBottom: 32 }}>
            The UI thread encountered a critical error while mapping market data. 
            This usually happens due to malformed API responses or unexpected data structures.
          </p>
          <div style={{
            padding: 24,
            background: 'rgba(255,68,68,0.05)',
            border: '1px solid rgba(255,68,68,0.2)',
            borderRadius: 12,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            textAlign: 'left',
            maxWidth: 600,
            marginBottom: 32,
            overflow: 'auto',
            maxHeight: 200
          }}>
            <div style={{ color: 'var(--red)', fontWeight: 800, marginBottom: 8 }}>ERROR_TRACE:</div>
            {this.state.error?.message || 'Unknown Error'}
            <pre style={{ marginTop: 8, opacity: 0.5, fontSize: 10 }}>
              {this.state.error?.stack}
            </pre>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '14px 28px',
              background: 'var(--gold)',
              color: '#000',
              border: 'none',
              borderRadius: 32,
              fontWeight: 900,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <RefreshCw size={18} />
            REBOOT SYSTEM
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
