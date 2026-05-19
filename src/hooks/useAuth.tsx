import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => void;
  login: (email: string, password: string) => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, signOut: () => {},
  login: async () => ({ error: "Not initialized" }),
});

export const useAuth = () => useContext(AuthContext);

const AUTH_KEY = "secretary_jwt";

function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem("secretary_user");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function getToken(): string {
  return localStorage.getItem(AUTH_KEY) || "";
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verify token is still valid on mount
    const token = getToken();
    if (token) {
      fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(user => {
          if (user?.id) {
            setUser(user);
            localStorage.setItem("secretary_user", JSON.stringify(user));
          } else {
            localStorage.removeItem(AUTH_KEY);
            localStorage.removeItem("secretary_user");
            setUser(null);
          }
        })
        .catch(() => { localStorage.removeItem(AUTH_KEY); setUser(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<{ error?: string }> => {
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await resp.json();
      if (!resp.ok) return { error: data.error || "Login failed" };
      localStorage.setItem(AUTH_KEY, data.token);
      localStorage.setItem("secretary_user", JSON.stringify(data.user));
      setUser(data.user);
      return {};
    } catch (e: any) {
      return { error: e.message };
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem("secretary_user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, login }}>
      {children}
    </AuthContext.Provider>
  );
};
