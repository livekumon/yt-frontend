import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAuthToken,
  getMe,
  setAuthToken,
  type User,
} from "../api/backend";

type AuthState = {
  user: User | null;
  loading: boolean;
  token: string | null;
  refreshUser: () => Promise<void>;
  login: (token: string, user: User) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(() => getAuthToken());

  const refreshUser = useCallback(async () => {
    const t = getAuthToken();
    if (!t) {
      setUser(null);
      setToken(null);
      return;
    }
    try {
      const u = await getMe();
      setUser(u);
      setToken(t);
    } catch {
      setAuthToken(null);
      setUser(null);
      setToken(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (!getAuthToken()) {
        setLoading(false);
        return;
      }
      try {
        const u = await getMe();
        setUser(u);
        setToken(getAuthToken());
      } catch {
        setAuthToken(null);
        setUser(null);
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback((newToken: string, u: User) => {
    setAuthToken(newToken);
    setToken(newToken);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      token,
      refreshUser,
      login,
      logout,
    }),
    [user, loading, token, refreshUser, login, logout],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
