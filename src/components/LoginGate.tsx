import { useState, useEffect } from 'react';
import { api, setToken, getToken } from '../services/api';
import { ShieldAlert, KeyRound } from 'lucide-react';

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(!!getToken());
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if token is valid by trying to get status
    if (isAuthenticated) {
      api.getAutoTradeStatus().catch(() => {
        setIsAuthenticated(false);
        setToken('');
      });
    }
  }, [isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.login(password);
      setToken(res.token);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message || 'Access Denied');
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) return <>{children}</>;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--bg-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: 40,
        background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 'var(--radius-lg)', textAlign: 'center'
      }}>
        <div style={{ display: 'inline-flex', padding: 16, borderRadius: '50%', background: 'rgba(212,175,55,0.1)', color: 'var(--gold)', marginBottom: 24 }}>
          <ShieldAlert size={32} />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '0.1em', marginBottom: 8, color: 'var(--text-primary)' }}>
          SECURE TERMINAL
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 32 }}>
          Authentication required
        </p>

        <form onSubmit={handleLogin}>
          <div style={{ position: 'relative', marginBottom: 24 }}>
            <KeyRound size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="password"
              placeholder="Enter passphrase..."
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{
                width: '100%', padding: '14px 16px 14px 44px',
                background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 14,
                outline: 'none', fontFamily: "'JetBrains Mono', monospace"
              }}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          
          {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 16 }}>{error}</div>}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%', padding: 14, borderRadius: 'var(--radius-sm)',
              background: 'var(--gold)', color: '#000', fontWeight: 900,
              fontSize: 14, letterSpacing: '0.1em', border: 'none',
              cursor: loading || !password ? 'not-allowed' : 'pointer',
              opacity: loading || !password ? 0.5 : 1
            }}
          >
            {loading ? 'AUTHENTICATING...' : 'AUTHORIZE'}
          </button>
        </form>
      </div>
    </div>
  );
}
