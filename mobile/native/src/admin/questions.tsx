import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { mobileApi, type MobileMeta, type MobileQuestion, type QuestionPayload } from '../api';
import { shareLocalFile } from '../share';
import { Badge, Body, Button, Card, Chips, Empty, Field, Loading, Row, SectionTitle } from '../ui';
import { colors } from '../theme';

const blank: QuestionPayload = { question: '', optionA: '', optionB: '', optionC: '', optionD: '', correctAnswer: 'A', subject: 'Physics', topic: '', subtopic: '', difficulty: 'Medium', marks: 1, explanation: '' };

export function AdminQuestions({ onScanner }: { onScanner: () => void }) {
  const [meta, setMeta] = useState<MobileMeta | null>(null);
  const [questions, setQuestions] = useState<MobileQuestion[]>([]);
  const [form, setForm] = useState<QuestionPayload>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ subject: '', difficulty: '', page: 1 });
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 1 });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [metaData, response] = await Promise.all([mobileApi.getMeta(), mobileApi.getAdminQuestions({ ...filters, limit: 25 })]);
      setMeta(metaData); setQuestions(response.questions); setPageInfo({ total: response.total, totalPages: response.totalPages || 1 });
    } catch (error) { Alert.alert('Unable to load questions', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (![form.question, form.optionA, form.optionB, form.optionC, form.optionD, form.subject].every((item) => String(item || '').trim())) return Alert.alert('Complete all required question fields.');
    try { setBusy(true); editingId ? await mobileApi.updateAdminQuestion(editingId, form) : await mobileApi.createAdminQuestion(form); setForm({ ...blank, subject: form.subject }); setEditingId(null); await load(); }
    catch (error) { Alert.alert('Unable to save question', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  const edit = (question: MobileQuestion) => { setEditingId(question._id); setForm({ question: question.question, optionA: question.optionA, optionB: question.optionB, optionC: question.optionC, optionD: question.optionD, correctAnswer: question.correctAnswer, subject: question.subject, topic: question.topic || '', subtopic: question.subtopic || '', difficulty: question.difficulty, marks: question.marks, explanation: question.explanation || '' }); };
  const remove = (question: MobileQuestion) => Alert.alert('Delete question?', question.question.slice(0, 100), [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { setBusy(true); await mobileApi.deleteAdminQuestion(question._id); await load(); } finally { setBusy(false); } } }]);
  const bulkImport = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], copyToCacheDirectory: true });
    if (picked.canceled) return; const file = picked.assets[0]; const data = new FormData(); data.append('csvFile', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
    try { setBusy(true); const result = await mobileApi.bulkImportAdminQuestions(data); Alert.alert('Import complete', `${result.created} questions added · ${result.skipped} skipped`); await load(); }
    catch (error) { Alert.alert('Import failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  if (loading || !meta) return <Loading message="Loading question bank…" />;
  return <>
    <Card><SectionTitle>{editingId ? 'Edit question' : 'Create question'}</SectionTitle><Field label="Question" value={form.question} onChangeText={(question) => setForm({ ...form, question })} multiline />{(['A', 'B', 'C', 'D'] as const).map((key) => <Field key={key} label={`Option ${key}`} value={form[`option${key}`]} onChangeText={(value) => setForm({ ...form, [`option${key}`]: value })} />)}<Body muted>Correct Answer</Body><Chips values={['A', 'B', 'C', 'D']} selected={[form.correctAnswer]} onChange={(values) => setForm({ ...form, correctAnswer: values[0] as QuestionPayload['correctAnswer'] })} /><Body muted>Subject</Body><Chips values={meta.allSubjects} selected={[form.subject]} onChange={(values) => setForm({ ...form, subject: values[0] })} /><Field label="Topic" value={form.topic || ''} onChangeText={(topic) => setForm({ ...form, topic })} /><Field label="Subtopic" value={form.subtopic || ''} onChangeText={(subtopic) => setForm({ ...form, subtopic })} /><Body muted>Difficulty</Body><Chips values={['Easy', 'Medium', 'Hard']} selected={[form.difficulty]} onChange={(values) => setForm({ ...form, difficulty: values[0] as QuestionPayload['difficulty'] })} /><Field label="Marks" value={String(form.marks)} onChangeText={(marks) => setForm({ ...form, marks: Number(marks) || 1 })} keyboardType="decimal-pad" /><Field label="Explanation (optional)" value={form.explanation || ''} onChangeText={(explanation) => setForm({ ...form, explanation })} multiline /><Row><View style={{ flex: 1 }}><Button title={editingId ? 'Save Changes' : 'Add Question'} onPress={save} busy={busy} /></View>{editingId ? <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" onPress={() => { setEditingId(null); setForm(blank); }} /></View> : null}</Row></Card>
    <Card><SectionTitle>Import tools</SectionTitle><Button title="Smart Question Scanner" onPress={onScanner} /><Button title="Import Excel / CSV" variant="secondary" onPress={bulkImport} busy={busy} /><Button title="Download Excel Template" variant="secondary" onPress={async () => { try { setBusy(true); await shareLocalFile(await mobileApi.downloadQuestionTemplate(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Question template'); } catch (error) { Alert.alert('Download failed', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } }} /></Card>
    <Card><SectionTitle>Filters</SectionTitle><Chips values={['All', ...meta.allSubjects]} selected={[filters.subject || 'All']} onChange={(values) => setFilters({ ...filters, subject: values[0] === 'All' ? '' : values[0], page: 1 })} /><Chips values={['All levels', 'Easy', 'Medium', 'Hard']} selected={[filters.difficulty || 'All levels']} onChange={(values) => setFilters({ ...filters, difficulty: values[0] === 'All levels' ? '' : values[0], page: 1 })} /></Card>
    <SectionTitle>Question bank ({pageInfo.total})</SectionTitle>
    {questions.length ? questions.map((question) => <Card key={question._id}><Row><Badge>{question.subject}</Badge><Badge tone={question.difficulty === 'Hard' ? 'danger' : question.difficulty === 'Easy' ? 'primary' : 'warning'}>{question.difficulty}</Badge><Body muted>{question.marks} mark(s)</Body></Row><Text selectable style={{ color: colors.label, fontWeight: '900', fontSize: 16, lineHeight: 23 }}>{question.question}</Text><Body muted>A. {question.optionA}{'\n'}B. {question.optionB}{'\n'}C. {question.optionC}{'\n'}D. {question.optionD}</Body><Body>Correct: {question.correctAnswer}</Body><Row><View style={{ flex: 1 }}><Button title="Edit" variant="secondary" compact onPress={() => edit(question)} /></View><View style={{ flex: 1 }}><Button title="Delete" variant="danger" compact onPress={() => remove(question)} /></View></Row></Card>) : <Empty message="No questions match these filters." />}
    <Row><View style={{ flex: 1 }}><Button title="Previous" variant="secondary" disabled={filters.page <= 1} onPress={() => setFilters({ ...filters, page: filters.page - 1 })} /></View><Body>Page {filters.page}/{pageInfo.totalPages}</Body><View style={{ flex: 1 }}><Button title="Next" variant="secondary" disabled={filters.page >= pageInfo.totalPages} onPress={() => setFilters({ ...filters, page: filters.page + 1 })} /></View></Row>
  </>;
}
