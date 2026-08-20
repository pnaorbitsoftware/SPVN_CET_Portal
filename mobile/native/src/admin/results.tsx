import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { mobileApi, type AdminResultsResponse } from '../api';
import { shareLocalFile } from '../share';
import { Badge, Body, Button, Card, Chips, Empty, Loading, Row, SectionTitle } from '../ui';
import { colors } from '../theme';

export function AdminResults() {
  const [data, setData] = useState<AdminResultsResponse | null>(null);
  const [groupId, setGroupId] = useState('');
  const [testId, setTestId] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await mobileApi.getAdminResults(groupId, testId)); }
    catch (error) { Alert.alert('Unable to load results', error instanceof Error ? error.message : 'Please try again.'); }
  }, [groupId, testId]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading message="Loading results…" />;
  return <>
    <Card><SectionTitle>Filter results</SectionTitle><Body muted>Batch</Body><Chips values={['All batches', ...data.groups.map((group) => group.name)]} selected={[groupId ? data.groups.find((group) => group._id === groupId)?.name || 'All batches' : 'All batches']} onChange={(values) => { setGroupId(data.groups.find((group) => group.name === values[0])?._id || ''); setTestId(''); }} /><Body muted>Test</Body><Chips values={['All tests', ...data.tests.filter((test) => !groupId || test.groups?.some((group) => group._id === groupId)).map((test) => test.title)]} selected={[testId ? data.tests.find((test) => test._id === testId)?.title || 'All tests' : 'All tests']} onChange={(values) => setTestId(data.tests.find((test) => test.title === values[0])?._id || '')} /><Button title="Export Results Excel" onPress={async () => { try { setBusy(true); await shareLocalFile(await mobileApi.downloadAdminResults(groupId, testId), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Exam results'); } catch (error) { Alert.alert('Export failed', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } }} busy={busy} /></Card>
    <SectionTitle>Completed results ({data.results.length})</SectionTitle>
    {data.results.length ? data.results.map((result) => <Card key={result._id}><Row><Badge>{result.rank ? `Rank ${result.rank}` : 'Result'}</Badge><Body muted>{result.submittedAt ? new Date(result.submittedAt).toLocaleDateString() : ''}</Body></Row><Text selectable style={{ color: colors.label, fontWeight: '900', fontSize: 16 }}>{result.studentId?.name || 'Student'} · {result.testId?.title || 'Test'}</Text><Body>{result.score}/{result.totalMarks} marks · {result.percentile ?? 0} percentile</Body><Row><View style={{ flex: 1 }}><Button title="View Detail" variant="secondary" compact onPress={() => router.push({ pathname: '/result/[result-id]', params: { 'result-id': result._id } })} /></View><View style={{ flex: 1 }}><Button title="PDF" compact onPress={async () => { try { await shareLocalFile(await mobileApi.downloadResult(result._id), 'application/pdf', 'Result PDF'); } catch (error) { Alert.alert('Download failed', error instanceof Error ? error.message : 'Please try again.'); } }} /></View></Row></Card>) : <Empty message="No completed results for this selection." />}
  </>;
}
