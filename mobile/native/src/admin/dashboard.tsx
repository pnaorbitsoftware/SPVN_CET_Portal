import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { mobileApi, type AdminDashboard } from '../api';
import { Badge, Body, Card, Empty, Loading, Row, SectionTitle, Stat } from '../ui';
import { colors } from '../theme';

const actions = ['Students', 'Batches', 'Syllabus', 'Questions', 'Tests', 'Results', 'Documents'] as const;

export function AdminDashboardView({ onNavigate }: { onNavigate: (section: typeof actions[number]) => void }) {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const load = useCallback(() => mobileApi.getAdminDashboard().then(setData).catch((error) => Alert.alert('Unable to load dashboard', error.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading message="Loading administration…" />;
  return <>
    <Row wrap><Stat value={data.stats.students} label="Students" /><Stat value={data.stats.groups} label="Batches" /><Stat value={data.stats.questions} label="Questions" /><Stat value={data.stats.tests} label="Tests" /><Stat value={data.stats.submittedResults} label="Results" /></Row>
    <SectionTitle>Management</SectionTitle>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>{actions.map((action) => <Pressable key={action} onPress={() => onNavigate(action)} style={{ width: '47%', minHeight: 64, backgroundColor: colors.card, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', padding: 10 }}><Text style={{ color: colors.primary, fontWeight: '900' }}>{action}</Text></Pressable>)}</View>
    <SectionTitle>Recent results</SectionTitle>
    {data.recentResults.length ? data.recentResults.map((result) => <Card key={result._id}><Row><Badge>{result.rank ? `Rank ${result.rank}` : 'Result'}</Badge><Body muted>{result.submittedAt ? new Date(result.submittedAt).toLocaleDateString() : ''}</Body></Row><Text selectable style={{ color: colors.label, fontWeight: '900' }}>{result.studentId?.name || 'Student'} · {result.testId?.title || 'Test'}</Text><Body>{result.score}/{result.totalMarks} marks</Body></Card>) : <Empty message="No submitted results." />}
  </>;
}
