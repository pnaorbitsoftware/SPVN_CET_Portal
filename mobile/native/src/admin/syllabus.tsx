import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { mobileApi, type MobileMeta, type MobileTopic } from '../api';
import { Badge, Body, Button, Card, Chips, Empty, Field, Loading, Row, SectionTitle } from '../ui';
import { colors } from '../theme';

export function AdminSyllabus() {
  const [meta, setMeta] = useState<MobileMeta | null>(null);
  const [topics, setTopics] = useState<MobileTopic[]>([]);
  const [course, setCourse] = useState('CET');
  const [subject, setSubject] = useState('Physics');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subtopics, setSubtopics] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [metaData, topicData] = await Promise.all([mobileApi.getMeta(), mobileApi.getAdminTopics(course, subject)]);
      setMeta(metaData); setTopics(topicData.topics);
    } catch (error) { Alert.alert('Unable to load syllabus', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setLoading(false); }
  }, [course, subject]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!name.trim()) return Alert.alert('Unit name required');
    const payload = { name: name.trim(), course, subject, subtopics: subtopics.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
    try { setBusy(true); editingId ? await mobileApi.updateAdminTopic(editingId, payload) : await mobileApi.createAdminTopic(payload); setName(''); setSubtopics(''); setEditingId(null); await load(); }
    catch (error) { Alert.alert('Unable to save syllabus unit', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const edit = (topic: MobileTopic) => { setEditingId(topic._id); setName(topic.name); setSubtopics(topic.subtopics.join('\n')); };
  const remove = (topic: MobileTopic) => Alert.alert('Delete syllabus unit?', topic.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { setBusy(true); await mobileApi.deleteAdminTopic(topic._id); if (editingId === topic._id) { setEditingId(null); setName(''); setSubtopics(''); } await load(); } finally { setBusy(false); } } }]);

  const importPdf = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0]; const data = new FormData();
    data.append('syllabusPdf', { uri: file.uri, name: file.name, type: file.mimeType || 'application/pdf' } as unknown as Blob); data.append('course', course); data.append('subject', subject);
    try { setBusy(true); const result = await mobileApi.importAdminSyllabus(data); Alert.alert('Syllabus imported', `${result.created} added · ${result.updated} updated${result.warnings.length ? ` · ${result.warnings.length} warnings` : ''}`); await load(); }
    catch (error) { Alert.alert('Import failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  if (loading || !meta) return <Loading message="Loading syllabus…" />;
  const subjects = meta.subjectsByCourse[course] || meta.allSubjects;
  return <>
    <Card><SectionTitle>Course and subject</SectionTitle><Chips values={meta.courses} selected={[course]} onChange={(values) => { setCourse(values[0]); const next = meta.subjectsByCourse[values[0]] || meta.allSubjects; setSubject(next[0]); }} /><Chips values={subjects} selected={[subject]} onChange={(values) => setSubject(values[0])} /></Card>
    <Card><SectionTitle>{editingId ? 'Edit unit' : 'Add syllabus unit'}</SectionTitle><Field label="Unit / Chapter Name" value={name} onChangeText={setName} /><Field label="Subtopics (one per line)" value={subtopics} onChangeText={setSubtopics} multiline /><Row><View style={{ flex: 1 }}><Button title={editingId ? 'Save Changes' : 'Add Unit'} onPress={save} busy={busy} /></View>{editingId ? <View style={{ flex: 1 }}><Button title="Cancel Edit" variant="secondary" onPress={() => { setEditingId(null); setName(''); setSubtopics(''); }} /></View> : null}</Row><Button title="Scan & Import Syllabus PDF" variant="secondary" onPress={importPdf} busy={busy} /></Card>
    <SectionTitle>{course} · {subject} ({topics.length} units)</SectionTitle>
    {topics.length ? topics.map((topic) => <Card key={topic._id}><Row><Text selectable style={{ flex: 1, color: colors.label, fontWeight: '900', fontSize: 17 }}>{topic.name}</Text><Badge>{topic.subtopics.length} subtopics</Badge></Row>{topic.subtopics.length ? <Body muted>{topic.subtopics.join(' · ')}</Body> : <Body muted>No subtopics</Body>}<Row><View style={{ flex: 1 }}><Button title="Edit" variant="secondary" compact onPress={() => edit(topic)} /></View><View style={{ flex: 1 }}><Button title="Delete" variant="danger" compact onPress={() => remove(topic)} /></View></Row></Card>) : <Empty message="No syllabus units for this selection." />}
  </>;
}
