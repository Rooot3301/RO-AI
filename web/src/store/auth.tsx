import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler } from '../api/client';

type Status = 'loading' | 'anon' | 'authed' | 'error';
interface AuthCtx {
  status: Status; username: string | null; error: string | null;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Appelé quand le serveur répond 401 : retour à l'écran de connexion. */
  expire: () => void;
  retry: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setStatus('loading');
    api.me().then((r) => { setUsername(r.username); setStatus('authed'); setError(null); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) { setStatus('anon'); setError(null); }
        else { setStatus('error'); setError(e instanceof Error ? e.message : String(e)); }
      });
  }, []);
  useEffect(() => { check(); }, [check]);

  const expire = useCallback(() => { setUsername(null); setStatus((s) => (s === 'authed' ? 'anon' : s)); }, []);
  useEffect(() => { setUnauthorizedHandler(expire); }, [expire]);

  const value = useMemo<AuthCtx>(() => ({
    status, username, error, expire, retry: check,
    login: async (u, p) => { const r = await api.login(u, p); setUsername(r.username); setStatus('authed'); setError(null); },
    logout: async () => { try { await api.logout(); } finally { setUsername(null); setStatus('anon'); } },
  }), [status, username, error, expire, check]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider manquant');
  return c;
}
