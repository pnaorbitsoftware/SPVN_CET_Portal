import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '../src/auth';
import { colors } from '../src/theme';

export default function RootLayout() {
  return <AuthProvider>
    <StatusBar style="auto" />
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false, contentStyle: { backgroundColor: colors.background }, headerTintColor: colors.primary }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="student" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="change-password" options={{ presentation: 'formSheet', sheetGrabberVisible: true, sheetAllowedDetents: [0.65, 1] }} />
      <Stack.Screen name="exam/[test-id]" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="result/[result-id]" />
      <Stack.Screen name="leaderboard/[test-id]" />
    </Stack>
  </AuthProvider>;
}
