import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { mobileApi, type AdminStudentDetail, type MobileAdminGroup, type MobileAdminStudent } from '../api';
import { shareLocalFile } from '../share';
import { Badge, Body, Button, Card, Chips, DataLine, Empty, Field, Loading, Row, SectionTitle } from '../ui';
import { colors } from '../theme';

const emptyForm = { name: '', rollNo: '', email: '', phone: '', parentContact: '', groupId: '' };

export function AdminStudents() {
  const [students, setStudents] = useState<MobileAdminStudent[]>([]);
  const [groups, setGroups] = useState<MobileAdminGroup[]>([]);
  const [selected, setSelected] = useState<AdminStudentDetail | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const response = await mobileApi.getAdminStudents(search); setStudents(response.students); setGroups(response.groups); }
    catch (error) { Alert.alert('Unable to load students', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setLoading(false); }
  }, [search]);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);

  const create = async () => {
    if (!form.name.trim() || !form.rollNo.trim()) return Alert.alert('Required fields', 'Student name and roll number are required.');
    try {
      setBusy(true);
      const response = await mobileApi.createAdminStudent({ ...form, groupId: form.groupId || undefined, role: 'student', isFirstLogin: true, profilePhoto: null, isActive: true, _id: '', id: '' });
      Alert.alert('Student created', `Temporary password: ${response.initialPassword}`);
      setForm(emptyForm); await load();
    } catch (error) { Alert.alert('Unable to create student', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const importStudents = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0];
    const data = new FormData();
    data.append('csvFile', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
    if (form.groupId) data.append('groupId', form.groupId);
    try {
      setBusy(true);
      const response = await mobileApi.bulkImportAdminStudents(data);
      Alert.alert('Import complete', `${response.created} new · ${response.existing} existing · ${response.assigned} assigned · ${response.skipped} skipped`);
      await load();
    } catch (error) { Alert.alert('Import failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const openProfile = async (studentId: string) => {
    try { setBusy(true); setSelected(await mobileApi.getAdminStudent(studentId)); }
    catch (error) { Alert.alert('Unable to load profile', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const remove = (student: MobileAdminStudent) => Alert.alert('Deactivate student?', `${student.name} will lose portal access and batch memberships.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Deactivate', style: 'destructive', onPress: async () => {
    try { setBusy(true); await mobileApi.deleteAdminStudent(student._id); setSelected(null); await load(); }
    catch (error) { Alert.alert('Unable to deactivate', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  } }]);

  if (loading) return <Loading message="Loading students…" />;
  if (selected) return <>
    <Button title="Back to Students" variant="ghost" onPress={() => setSelected(null)} />
    <Card><Row><Text selectable style={{ flex: 1, color: colors.label, fontSize: 21, fontWeight: '900' }}>{selected.student.name}</Text><Badge tone={selected.student.isActive ? 'primary' : 'danger'}>{selected.student.isActive ? 'Active' : 'Inactive'}</Badge></Row><DataLine label="Roll Number" value={selected.student.rollNo || '—'} /><DataLine label="Email" value={selected.student.email || '—'} /><DataLine label="Phone" value={selected.student.phone || '—'} /><DataLine label="Parent Contact" value={selected.student.parentContact || '—'} /><DataLine label="Batches" value={selected.groups.map((group) => group.name).join(', ') || 'None'} /><Row><View style={{ flex: 1 }}><DataLine label="Tests" value={selected.stats.tests} /></View><View style={{ flex: 1 }}><DataLine label="Average" value={`${selected.stats.averageScore}%`} /></View></Row><Button title="Deactivate Student" variant="danger" onPress={() => remove(selected.student)} busy={busy} /></Card>
    <SectionTitle>Recent results</SectionTitle>{selected.results.length ? selected.results.map((result) => <Card key={result._id}><Text selectable style={{ color: colors.label, fontWeight: '800' }}>{result.testId?.title || 'Test'}</Text><Body>{result.score}/{result.totalMarks} · Rank {result.rank || '—'}</Body></Card>) : <Empty message="No results." />}
    <SectionTitle>Documents</SectionTitle>{selected.documents.length ? selected.documents.map((document) => <Card key={document._id}><Body>{document.originalName}</Body><Body muted>{document.description}</Body></Card>) : <Empty message="No documents." />}
  </>;

  return <>
    <Card>
      <SectionTitle>Add student</SectionTitle>
      <Field label="Full Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
      <Field label="Roll Number" value={form.rollNo} onChangeText={(rollNo) => setForm({ ...form, rollNo })} autoCapitalize="characters" />
      <Field label="Email (optional)" value={form.email} onChangeText={(email) => setForm({ ...form, email })} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Phone (optional)" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} keyboardType="phone-pad" />
      <Field label="Parent Contact (optional)" value={form.parentContact} onChangeText={(parentContact) => setForm({ ...form, parentContact })} keyboardType="phone-pad" />
      <Body muted>Assign to batch</Body><Chips values={['No batch', ...groups.map((group) => group.name)]} selected={[form.groupId ? groups.find((group) => group._id === form.groupId)?.name || 'No batch' : 'No batch']} onChange={(values) => setForm({ ...form, groupId: groups.find((group) => group.name === values[0])?._id || '' })} />
      <Button title="Create Student" onPress={create} busy={busy} />
    </Card>
    <Card><SectionTitle>Bulk student import</SectionTitle><Body muted>Select a batch above, then import Excel/CSV. Existing roll numbers are retained and assigned to the selected batch.</Body><Button title="Select Excel / CSV & Import" onPress={importStudents} busy={busy} /><Button title="Download Import Template" variant="secondary" onPress={async () => { try { setBusy(true); await shareLocalFile(await mobileApi.downloadStudentTemplate(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Student import template'); } catch (error) { Alert.alert('Download failed', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } }} /></Card>
    <SectionTitle>Students ({students.length})</SectionTitle>
    <Field label="Search" value={search} onChangeText={setSearch} placeholder="Name or roll number" />
    {students.length ? students.map((student) => <Card key={student._id}><Row><Text selectable style={{ flex: 1, color: colors.label, fontWeight: '900', fontSize: 16 }}>{student.name}</Text><Badge tone={student.isActive ? 'primary' : 'danger'}>{student.isActive ? 'Active' : 'Inactive'}</Badge></Row><Body muted>{student.rollNo || 'No roll number'} · {student.parentContact || 'No parent contact'}</Body><Row><View style={{ flex: 1 }}><Button title="Profile" variant="secondary" compact onPress={() => openProfile(student._id)} busy={busy} /></View><View style={{ flex: 1 }}><Button title="Deactivate" variant="danger" compact onPress={() => remove(student)} disabled={!student.isActive} /></View></Row></Card>) : <Empty message="No students found." />}
  </>;
}
