import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { useAuth } from '../src/auth';
import { Button, Card, Chips, Field, Screen } from '../src/ui';
import { colors } from '../src/theme';

export default function LoginRoute() {
  const { login } = useAuth();
  const [role, setRole] = useState<'student' | 'admin'>('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!identifier.trim() || !password) return Alert.alert('Login details required', 'Enter your credentials to continue.');
    try {
      setBusy(true);
      const user = await login(identifier.trim(), password, role);
      router.replace(user.isFirstLogin ? '/change-password' : user.role === 'admin' ? '/admin' : '/student');
    } catch (error) {
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Please try again.');
    } finally { setBusy(false); }
  };

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.primary }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen style={{ backgroundColor: colors.primary, justifyContent: 'center', paddingVertical: 56 }}>
      <View style={{ alignItems: 'center', gap: 6, paddingBottom: 14 }}>
        <Text selectable style={{ color: colors.gold, fontSize: 44, fontWeight: '900', letterSpacing: 3 }}>SPVN</Text>
        <Text selectable style={{ color: colors.white, fontSize: 28, fontWeight: '900' }}>Exam Portal</Text>
        <Text selectable style={{ color: '#d9eee2', textAlign: 'center' }}>Shardabai Pawar Vidya Niketan</Text>
      </View>
      <Card style={{ padding: 20, gap: 16 }}>
        <Chips values={['student', 'admin']} selected={[role]} onChange={(value) => setRole(value[0] as 'student' | 'admin')} />
        <Field label={role === 'student' ? 'Roll Number' : 'Admin Email'} value={identifier} onChangeText={setIdentifier} autoCapitalize="none" placeholder={role === 'student' ? 'Enter roll number' : 'admin@example.com'} />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Enter password" />
        <Button title="Secure Login" onPress={submit} busy={busy} />
      </Card>
    </Screen>
  </KeyboardAvoidingView>;
}
