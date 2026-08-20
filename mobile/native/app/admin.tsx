import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { AdminDashboardView } from '../src/admin/dashboard';
import { AdminDocuments } from '../src/admin/documents';
import { AdminGroups } from '../src/admin/groups';
import { AdminQuestions } from '../src/admin/questions';
import { AdminResults } from '../src/admin/results';
import { AdminStudents } from '../src/admin/students';
import { AdminSyllabus } from '../src/admin/syllabus';
import { AdminTests } from '../src/admin/tests';
import { SmartScannerScreen } from '../src/SmartScannerScreen';
import { useAuth } from '../src/auth';
import { Button, Card, Chips, DataLine, Screen, Title } from '../src/ui';

type Section = 'Dashboard' | 'Students' | 'Batches' | 'Syllabus' | 'Questions' | 'Scanner' | 'Tests' | 'Results' | 'Documents' | 'Account';
const sections: Section[] = ['Dashboard', 'Students', 'Batches', 'Syllabus', 'Questions', 'Scanner', 'Tests', 'Results', 'Documents', 'Account'];

export default function AdminRoute() {
  const { user, logout } = useAuth();
  const [section, setSection] = useState<Section>('Dashboard');
  if (!user || user.role !== 'admin') return null;
  return <Screen>
    <Stack.Title>SPVN Admin</Stack.Title>
    <Title>Namaskar, {user.name}</Title>
    <Chips values={sections} selected={[section]} onChange={(value) => setSection(value[0] as Section)} />
    {section === 'Dashboard' ? <AdminDashboardView onNavigate={setSection} /> : null}
    {section === 'Students' ? <AdminStudents /> : null}
    {section === 'Batches' ? <AdminGroups /> : null}
    {section === 'Syllabus' ? <AdminSyllabus /> : null}
    {section === 'Questions' ? <AdminQuestions onScanner={() => setSection('Scanner')} /> : null}
    {section === 'Scanner' ? <SmartScannerScreen onClose={() => setSection('Questions')} embedded /> : null}
    {section === 'Tests' ? <AdminTests /> : null}
    {section === 'Results' ? <AdminResults /> : null}
    {section === 'Documents' ? <AdminDocuments /> : null}
    {section === 'Account' ? <Card><DataLine label="Administrator" value={user.name} /><DataLine label="Email" value={user.email || '—'} /><Button title="Change Password" variant="secondary" onPress={() => router.push('/change-password')} /><Button title="Logout" variant="danger" onPress={() => Alert.alert('Logout?', 'You will need to sign in again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Logout', style: 'destructive', onPress: async () => { await logout(); router.replace('/login'); } }])} /></Card> : null}
  </Screen>;
}
