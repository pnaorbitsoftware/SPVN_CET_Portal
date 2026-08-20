import React, { createContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { mobileApi, type MobileUser } from './api';

type AuthValue = {
  user: MobileUser | null;
  loading: boolean;
  login: (identifier: string, password: string, role: MobileUser['role']) => Promise<MobileUser>;
  logout: () => Promise<void>;
  changePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    mobileApi.restoreSession().then((session) => setUser(session?.user || null)).finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthValue>(() => ({
    user,
    loading,
    login: async (identifier, password, role) => {
      const session = await mobileApi.login(identifier, password, role);
      setUser(session.user);
      return session.user;
    },
    logout: async () => {
      await mobileApi.clearSession();
      setUser(null);
    },
    changePassword: async (payload) => {
      const response = await mobileApi.changePassword(payload);
      setUser(response.user);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = React.use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
