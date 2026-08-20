import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '../src/auth';
import { Button, Card, Field, Screen, Title } from '../src/ui';

export default function ChangePasswordRoute() {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (newPassword.length < 6) return Alert.alert('Weak password', 'Use at least 6 characters.');
    if (newPassword !== confirmPassword) return Alert.alert('Passwords do not match', 'Re-enter the new password.');
    try {
      setBusy(true);
      await changePassword({ currentPassword, newPassword, confirmPassword });
      Alert.alert('Password changed', 'Your new password is active.');
      router.replace(user?.role === 'admin' ? '/admin' : '/student');
    } catch (error) {
      Alert.alert('Unable to change password', error instanceof Error ? error.message : 'Please try again.');
    } finally { setBusy(false); }
  };

  return <Screen>
    <Stack.Title>Change Password</Stack.Title>
    <Title>{user?.isFirstLogin ? 'Secure your account' : 'Change password'}</Title>
    <Card>
      {!user?.isFirstLogin ? <Field label="Current Password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry /> : null}
      <Field label="New Password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
      <Field label="Confirm Password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
      <Button title="Save Password" onPress={submit} busy={busy} />
    </Card>
  </Screen>;
}
