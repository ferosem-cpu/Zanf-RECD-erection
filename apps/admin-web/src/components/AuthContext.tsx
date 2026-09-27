"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { api, setToken, clearToken } from "@/lib/apiClient";
import { useRouter } from "next/navigation";
import { isSessionRejected, retryDelayMs } from "@/lib/sessionRetry";

export interface UserSession {
  id: string;
  name: string;
  email: string | null;
  mustChangePassword: boolean;
  role: {
    key: string;
    name: string;
  };
  permissions: string[];
  customerId?: string | null;
  vendorId?: string | null;
  orderNumber?: string;
}

interface AuthContextType {
  user: UserSession | null;
  permissions: string[];
  hasPermission: (permissionKey: string) => boolean;
  login: (token: string, orderNumber?: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
  /** True while the last session check couldn't reach the API and a retry is scheduled. */
  connectionIssue: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const router = useRouter();
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  // Lets the retry timer call the latest fetchSession without a circular useCallback dependency.
  const fetchSessionRef = useRef<() => Promise<void>>(async () => {});

  const cancelRetry = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const fetchSession = useCallback(async () => {
    cancelRetry();
    const token = typeof window !== "undefined" ? window.localStorage.getItem("recd_token") : null;
    if (!token) {
      retryAttempt.current = 0;
      setConnectionIssue(false);
      setUser(null);
      setLoading(false);
      return;
    }

    let data: UserSession;
    try {
      data = await api<UserSession>("/auth/me");
    } catch (err) {
      if (isSessionRejected(err)) {
        // The server said the token is no good (expired, user deactivated, ...): sign out.
        console.error("Session rejected", err);
        clearToken();
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("recd_customer_ord");
        }
        retryAttempt.current = 0;
        setConnectionIssue(false);
        setUser(null);
        setLoading(false);
        return;
      }
      // Network failure / 5xx: keep the token and whatever session we already have, and retry
      // with backoff. On the very first load `loading` stays true, so the route guard shows the
      // "reconnecting" screen instead of bouncing the user to /login.
      const delay = retryDelayMs(retryAttempt.current);
      retryAttempt.current += 1;
      console.warn(`Session check failed; retrying in ${Math.round(delay / 1000)}s`, err);
      setConnectionIssue(true);
      retryTimer.current = setTimeout(() => {
        void fetchSessionRef.current();
      }, delay);
      return;
    }

    retryAttempt.current = 0;
    setConnectionIssue(false);

    const savedOrderNumber = typeof window !== "undefined" ? window.localStorage.getItem("recd_customer_ord") : null;
    if (data.role.key === "customer" && savedOrderNumber) {
      data.orderNumber = savedOrderNumber;
    }

    setUser(data);

    try {
      const settings = await api<{ themeKey: string; logoDataUrl: string | null; customColors: any }>("/settings");
      if (typeof window !== "undefined") {
        const { saveThemeKey, saveLogo, clearLogo, saveCustomColors, clearCustomColors } = require("@/lib/settingsStore");
        if (settings.themeKey) {
          saveThemeKey(settings.themeKey);
        }
        if (settings.logoDataUrl) {
          saveLogo(settings.logoDataUrl);
        } else {
          clearLogo();
        }
        if (settings.customColors) {
          saveCustomColors(settings.customColors);
        } else {
          clearCustomColors();
        }
        window.dispatchEvent(new Event("settings-changed"));
      }
    } catch (err) {
      console.error("Failed to load settings in AuthContext", err);
    } finally {
      // As before: only leave the loading screen once the theme settings have been applied.
      setLoading(false);
    }
  }, [cancelRetry]);

  fetchSessionRef.current = fetchSession;

  useEffect(() => {
    fetchSession();
    // Retry straight away when the browser says the network is back, instead of waiting out
    // the backoff.
    const onOnline = () => {
      if (retryTimer.current) {
        retryAttempt.current = 0;
        void fetchSessionRef.current();
      }
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      cancelRetry();
    };
  }, [fetchSession, cancelRetry]);

  const login = useCallback(async (token: string, orderNumber?: string) => {
    setLoading(true);
    setToken(token);
    if (orderNumber && typeof window !== "undefined") {
      window.localStorage.setItem("recd_customer_ord", orderNumber);
    }
    await fetchSession();
  }, [fetchSession]);

  const logout = useCallback(() => {
    cancelRetry();
    retryAttempt.current = 0;
    setConnectionIssue(false);
    clearToken();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("recd_customer_ord");
    }
    setUser(null);
    router.push("/login");
  }, [router, cancelRetry]);

  const hasPermission = useCallback((permissionKey: string) => {
    if (!user) return false;
    return user.permissions.includes(permissionKey);
  }, [user]);

  const refresh = useCallback(async () => {
    await fetchSession();
  }, [fetchSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions: user?.permissions || [],
        hasPermission,
        login,
        logout,
        loading,
        connectionIssue,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
