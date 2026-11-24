import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { Org, User } from "./types";

interface AuthState { user: User | null; org: Org | null; loading: boolean; login: (token: string) => Promise<User>; logout: () => void; refresh: () => Promise<void> }
const Ctx = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!getToken()) { setUser(null); setOrg(null); return; }
    try { const me = await api<{ user: User; org: Org }>("/me"); setUser(me.user); setOrg(me.org); }
    catch { setToken(null); setUser(null); }
  };
  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const login = async (token: string) => {
    setToken(token);
    const me = await api<{ user: User; org: Org }>("/me");
    setUser(me.user); setOrg(me.org);
    return me.user;
  };
  const logout = () => { setToken(null); setUser(null); setOrg(null); };

  return <Ctx.Provider value={{ user, org, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
