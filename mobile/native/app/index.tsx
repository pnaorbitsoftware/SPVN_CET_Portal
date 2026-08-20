import { Redirect } from 'expo-router';

import { useAuth } from '../src/auth';
import { Loading } from '../src/ui';

export default function IndexRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Loading message="Restoring secure session…" />;
  if (!user) return <Redirect href="/login" />;
  if (user.isFirstLogin) return <Redirect href="/change-password" />;
  return <Redirect href={user.role === 'admin' ? '/admin' : '/student'} />;
}
