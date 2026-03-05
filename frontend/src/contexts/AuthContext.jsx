import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState({
    loading: true,
    setupRequired: false,
    authenticated: false,
    user: null
  });

  const fetchAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/user/me');
      const data = await res.json();

      if (data.setupRequired) {
        setAuthState({ loading: false, setupRequired: true, authenticated: false, user: null });
      } else if (data.authenticated && data.user) {
        setAuthState({ loading: false, setupRequired: false, authenticated: true, user: data.user });
      } else {
        setAuthState({ loading: false, setupRequired: false, authenticated: false, user: null });
      }
    } catch {
      setAuthState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => { fetchAuth(); }, [fetchAuth]);

  const logout = async () => {
    try { await fetch('/api/auth/user/logout', { method: 'POST' }); } catch { /* ignore */ }
    setAuthState({ loading: false, setupRequired: false, authenticated: false, user: null });
  };

  return (
    <AuthContext.Provider value={{ ...authState, refetch: fetchAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
