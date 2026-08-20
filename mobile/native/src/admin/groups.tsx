import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { mobileApi, type AdminGroupDetail, type MobileAdminGroup, type MobileAdminStudent } from '../api';
import { shareLocalFile } from '../share';
import { Badge, Body, Button, Card, Chips, DataLine, Empty, Field, Loading, Row, SectionTitle } from '../ui';
import { colors } from '../theme';

export function AdminGroups() {
  const [groups, setGroups] = useState<MobileAdminGroup[]>([]);
  const [detail, setDetail] = useState<AdminGroupDetail | null>(null);
  const [form, setForm] = useState({ name: '', description: '', academicYear: '2025-2026', course: '' });
  const [newStudent, setNewStudent] = useState({ name: '', rollNo: '' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setGroups((await mobileApi.getAdminGroups()).groups); }
    catch (error) { Alert.alert('Unable to load batches', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = async (groupId: string) => {
    try {
      setBusy(true);
      const response = await mobileApi.getAdminGroup(groupId);
      setDetail(response);
      setForm({ name: response.group.name, description: response.group.description || '', academicYear: response.group.academicYear || '2025-2026', course: response.group.course || '' });
    } catch (error) { Alert.alert('Unable to open batch', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (!form.name.trim()) return Alert.alert('Batch name required');
    try { setBusy(true); await mobileApi.createAdminGroup({ ...form, course: form.course || null, _id: '', members: [] }); setForm({ name: '', description: '', academicYear: '2025-2026', course: '' }); await load(); }
    catch (error) { Alert.alert('Unable to create batch', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const refreshDetail = async () => { if (detail) setDetail(await mobileApi.getAdminGroup(detail.group._id)); await load(); };
  const update = async () => {
    if (!detail) return;
    try { setBusy(true); await mobileApi.updateAdminGroup(detail.group._id, { name: form.name, description: form.description || null, academicYear: form.academicYear, course: form.course || null }); await refreshDetail(); Alert.alert('Saved', 'Batch details updated.'); }
    catch (error) { Alert.alert('Unable to update batch', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const assign = async (studentId: string) => {
    if (!detail) return;
    try { setBusy(true); await mobileApi.assignAdminGroupMember(detail.group._id, studentId); await refreshDetail(); }
    catch (error) { Alert.alert('Unable to add student', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const remove = (student: MobileAdminStudent) => {
    if (!detail) return;
    Alert.alert('Remove from batch?', student.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { try { setBusy(true); await mobileApi.removeAdminGroupMember(detail.group._id, student._id); await refreshDetail(); } finally { setBusy(false); } } }]);
  };

  const move = async (student: MobileAdminStudent, targetGroupId: string) => {
    if (!detail) return;
    try { setBusy(true); await mobileApi.moveAdminGroupMember(detail.group._id, student._id, targetGroupId); await refreshDetail(); }
    catch (error) { Alert.alert('Unable to move student', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const importStudents = async () => {
    if (!detail) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0]; const data = new FormData();
    data.append('csvFile', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob); data.append('groupId', detail.group._id);
    try { setBusy(true); const result = await mobileApi.bulkImportAdminStudents(data); Alert.alert('Import complete', `${result.created} new · ${result.existing} existing · ${result.assigned} assigned`); await refreshDetail(); }
    catch (error) { Alert.alert('Import failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const createStudent = async () => {
    if (!detail || !newStudent.name.trim() || !newStudent.rollNo.trim()) return Alert.alert('Name and roll number required');
    try { setBusy(true); const response = await mobileApi.createAdminStudent({ ...newStudent, groupId: detail.group._id }); Alert.alert('Student added', `Temporary password: ${response.initialPassword}`); setNewStudent({ name: '', rollNo: '' }); await refreshDetail(); }
    catch (error) { Alert.alert('Unable to add student', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const deleteGroup = () => {
    if (!detail) return;
    Alert.alert('Delete batch?', 'Memberships will be removed and this batch will be detached from tests.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { setBusy(true); await mobileApi.deleteAdminGroup(detail.group._id); setDetail(null); setForm({ name: '', description: '', academicYear: '2025-2026', course: '' }); await load(); } finally { setBusy(false); } } }]);
  };

  if (loading) return <Loading message="Loading batches…" />;
  if (detail) return <>
    <Button title="Back to Batches" variant="ghost" onPress={() => { setDetail(null); setForm({ name: '', description: '', academicYear: '2025-2026', course: '' }); }} />
    <Card><Row><Text selectable style={{ flex: 1, color: colors.label, fontSize: 21, fontWeight: '900' }}>{detail.group.name}</Text><Badge>{detail.members.length} students</Badge></Row><Field label="Batch Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} /><Field label="Description" value={form.description} onChangeText={(description) => setForm({ ...form, description })} /><Field label="Academic Year" value={form.academicYear} onChangeText={(academicYear) => setForm({ ...form, academicYear })} /><Body muted>Course</Body><Chips values={['None', 'JEE', 'CET', 'NEET']} selected={[form.course || 'None']} onChange={(values) => setForm({ ...form, course: values[0] === 'None' ? '' : values[0] })} /><Button title="Save Batch" onPress={update} busy={busy} /><Button title="Download Credentials PDF" variant="secondary" onPress={async () => { try { setBusy(true); await shareLocalFile(await mobileApi.downloadGroupCredentials(detail.group._id), 'application/pdf', `${detail.group.name} credentials`); } catch (error) { Alert.alert('Download failed', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } }} /><Button title="Delete Batch" variant="danger" onPress={deleteGroup} /></Card>
    <Card><SectionTitle>Add new student to batch</SectionTitle><Field label="Student Name" value={newStudent.name} onChangeText={(name) => setNewStudent({ ...newStudent, name })} /><Field label="Roll Number" value={newStudent.rollNo} onChangeText={(rollNo) => setNewStudent({ ...newStudent, rollNo })} autoCapitalize="characters" /><Button title="Create & Add Student" onPress={createStudent} busy={busy} /><Button title="Bulk Import into this Batch" variant="secondary" onPress={importStudents} busy={busy} /></Card>
    <SectionTitle>Current members</SectionTitle>{detail.members.length ? detail.members.map((student) => <Card key={student._id}><Text selectable style={{ color: colors.label, fontWeight: '900' }}>{student.name}</Text><Body muted>{student.rollNo || ''}</Body><Row><View style={{ flex: 1 }}><Button title="Remove" variant="danger" compact onPress={() => remove(student)} /></View>{detail.otherGroups.map((group) => <View key={group._id} style={{ flex: 1 }}><Button title={`Move → ${group.name}`} variant="secondary" compact onPress={() => move(student, group._id)} /></View>)}</Row></Card>) : <Empty message="No students in this batch." />}
    <SectionTitle>Add existing student</SectionTitle>{detail.availableStudents.length ? detail.availableStudents.slice(0, 100).map((student) => <Card key={student._id}><Row><View style={{ flex: 1 }}><Text selectable style={{ color: colors.label, fontWeight: '800' }}>{student.name}</Text><Body muted>{student.rollNo || ''}</Body></View><Button title="Add" compact onPress={() => assign(student._id)} busy={busy} /></Row></Card>) : <Empty message="All active students are already in this batch." />}
  </>;

  return <>
    <Card><SectionTitle>Create batch</SectionTitle><Field label="Batch Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} /><Field label="Description" value={form.description} onChangeText={(description) => setForm({ ...form, description })} /><Field label="Academic Year" value={form.academicYear} onChangeText={(academicYear) => setForm({ ...form, academicYear })} /><Body muted>Course</Body><Chips values={['None', 'JEE', 'CET', 'NEET']} selected={[form.course || 'None']} onChange={(values) => setForm({ ...form, course: values[0] === 'None' ? '' : values[0] })} /><Button title="Create Batch" onPress={create} busy={busy} /></Card>
    <SectionTitle>Batches ({groups.length})</SectionTitle>{groups.length ? groups.map((group) => <Card key={group._id}><Row><Text selectable style={{ flex: 1, color: colors.label, fontWeight: '900', fontSize: 17 }}>{group.name}</Text><Badge>{group.members.length}</Badge></Row><Body muted>{group.course || 'No course'} · {group.academicYear}</Body><Body>{group.description || 'No description'}</Body><Button title="Open Batch" variant="secondary" onPress={() => open(group._id)} busy={busy} /></Card>) : <Empty message="No batches created." />}
  </>;
}
