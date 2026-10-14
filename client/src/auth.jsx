import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, config: null, error: null });

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/api/auth/me');
      setState({ loading: false, user: data.user, config: data.config, error: null });
    } catch (e) {
      setState({ loading: false, user: null, config: null, error: e.status === 401 ? null : e.message });
    }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setState((s) => (s.user ? { ...s, user: null, expired: true } : s)));
  }, [refresh]);

  const login = useCallback(async (usuario, password) => {
    await api.post('/api/auth/login', { usuario, password });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } catch { /* sin conexión: se limpia igualmente */ }
    setState({ loading: false, user: null, config: null, error: null });
  }, []);

  const value = useMemo(() => {
    const perms = new Set(state.user?.permissions || []);
    return { ...state, login, logout, refresh, can: (...p) => p.some((x) => perms.has(x)) };
  }, [state, login, logout, refresh]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
