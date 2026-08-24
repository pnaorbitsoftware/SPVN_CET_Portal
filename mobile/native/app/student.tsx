import * as DocumentPicker from 'expo-document-picker';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { assetUrl, mobileApi, type MobileDocument, type MobileNotification, type MobileResult, type MobileTest, type PendingReleaseItem, type StudentDashboard, type TestInstructions } from '../src/api';
import { useAuth } from '../src/auth';
import { Badge, Body, Button, Card, Chips, DataLine, Empty, Field, Loading, Row, Screen, SectionTitle, Stat, Title } from '../src/ui';
import { colors } from '../src/theme';

type Section = 'Home' | 'Tests' | 'Results' | 'Alerts' | 'Documents' | 'Account';
const sections: Section[] = ['Home', 'Tests', 'Results', 'Alerts', 'Documents', 'Account'];

export default function StudentRoute() {
  const { user, logout } = useAuth();
  const [section, setSection] = useState<Section>('Home');
  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null);
  const [tests, setTests] = useState<MobileTest[]>([]);
  const [results, setResults] = useState<MobileResult[]>([]);
  const [pendingResults, setPendingResults] = useState<PendingReleaseItem[]>([]);
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [documents, setDocuments] = useState<MobileDocument[]>([]);
  const [instructions, setInstructions] = useState<TestInstructions | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState('');
  const [testAccessPassword, setTestAccessPassword] = useState('');

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const [dashboardData, testData, resultData, notificationData, documentData] = await Promise.all([
        mobileApi.getStudentDashboard(), mobileApi.getStudentTests(), mobileApi.getStudentResults(), mobileApi.getStudentNotifications(), mobileApi.getStudentDocuments(),
      ]);
      setDashboard(dashboardData); setTests(testData.tests); setResults(resultData.results); setPendingResults(resultData.pendingResults); setNotifications(notificationData.notifications); setDocuments(documentData.documents);
    } catch (error) {
      Alert.alert('Unable to load portal', error instanceof Error ? error.message : 'Please try again.');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openInstructions = async (test: MobileTest) => {
    if (test.result && ['submitted', 'auto_submitted'].includes(test.result.status || '')) {
      return router.push({ pathname: '/result/[result-id]', params: { 'result-id': test.result._id } });
    }
    try { setBusy(true); setInstructions(await mobileApi.getStudentInstructions(test._id)); }
    catch (error) { Alert.alert('Test unavailable', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const uploadDocument = async () => {
    const selection = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
    if (selection.canceled) return;
    const file = selection.assets[0];
    const data = new FormData();
    data.append('document', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
    data.append('description', description);
    try {
      setBusy(true);
      await mobileApi.uploadStudentDocument(data);
      setDescription('');
      const response = await mobileApi.getStudentDocuments();
      setDocuments(response.documents);
      Alert.alert('Uploaded', 'Your document is available to the administrator.');
    } catch (error) { Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const openNotification = (link?: string | null) => {
    if (!link) return;
    const resultId = link.match(/^\/results\/([^/]+)$/)?.[1];
    if (resultId) return router.push({ pathname: '/result/[result-id]', params: { 'result-id': resultId } });
    if (link.includes('/student/tests')) setSection('Tests');
    else if (link.includes('/student/results')) setSection('Results');
    else if (link.includes('/student/documents')) setSection('Documents');
    else setSection('Home');
  };

  const groupedTests = useMemo(() => {
    const groups: Record<string, MobileTest[]> = { 'Ready / Resume': [], Upcoming: [], Completed: [], Expired: [] };
    const now = Date.now();
    tests.forEach((test) => {
      const done = test.result && ['submitted', 'auto_submitted'].includes(test.result.status || '');
      const inProgress = test.result?.status === 'in_progress';
      if (done) groups.Completed.push(test);
      else if (inProgress || (!test.startTime || new Date(test.startTime).getTime() <= now) && (!test.endTime || new Date(test.endTime).getTime() >= now)) groups['Ready / Resume'].push(test);
      else if (test.startTime && new Date(test.startTime).getTime() > now) groups.Upcoming.push(test);
      else groups.Expired.push(test);
    });
    return groups;
  }, [tests]);

  if (loading) return <Loading message="Loading student portal…" />;
  if (!user || user.role !== 'student') return null;

  return <Screen refreshing={refreshing} onRefresh={() => load(true)}>
    <Stack.Title>SPVN Student</Stack.Title>
    <View style={{ gap: 2 }}><Title>Namaskar, {user.name}</Title><Body muted>{user.rollNo || 'Student'}</Body></View>
    <Chips values={sections} selected={[section]} onChange={(value) => { setSection(value[0] as Section); setInstructions(null); }} />

    {section === 'Home' ? <>
      <Row wrap><Stat value={dashboard?.stats.pending || 0} label="Pending" /><Stat value={dashboard?.stats.completed || 0} label="Completed" /><Stat value={`${dashboard?.stats.averageScore || 0}%`} label="Average" /><Stat value={`${dashboard?.stats.accuracy || 0}%`} label="Accuracy" /></Row>
      <SectionTitle>Upcoming tests</SectionTitle>
      {dashboard?.pendingTests.length ? dashboard.pendingTests.map((test) => <TestCard key={test._id} test={test} onOpen={() => openInstructions(test)} busy={busy} />) : <Empty message="No pending tests right now." />}
      <SectionTitle>Recent results</SectionTitle>
      {dashboard?.recentResults.length ? dashboard.recentResults.map((result) => <ResultCard key={result._id} result={result} />) : <Empty message="No submitted results yet." />}
      {dashboard?.pendingReleases.length ? <><SectionTitle>Submitted — Result Pending</SectionTitle>{dashboard.pendingReleases.map((item) => <PendingResultCard key={item.submission.id} item={item} />)}</> : null}
      <SectionTitle>Subject performance</SectionTitle>
      {dashboard?.subjectStats.length ? dashboard.subjectStats.map((subject) => <Card key={subject.name}><Row><Text selectable style={{ flex: 1, color: colors.label, fontWeight: '900' }}>{subject.name}</Text><Badge>{subject.percentage}%</Badge></Row><Body muted>{subject.marks}/{subject.maxMarks} marks across {subject.count} test(s)</Body></Card>) : <Empty message="Subject performance appears after submitted tests." />}
    </> : null}

    {section === 'Tests' ? <>
      {instructions ? <InstructionsCard value={instructions} accessPassword={testAccessPassword} onAccessPasswordChange={setTestAccessPassword} onUnlock={async () => { try { setBusy(true); await mobileApi.unlockStudentTest(instructions.test._id, testAccessPassword); setTestAccessPassword(''); setInstructions({ ...instructions, requiresAccess:false }); } catch (error) { Alert.alert('Access denied', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } }} onClose={() => { setInstructions(null); setTestAccessPassword(''); }} onStart={() => router.push({ pathname: '/exam/[test-id]', params: { 'test-id': instructions.test._id } })} busy={busy} /> : Object.entries(groupedTests).map(([label, values]) => values.length ? <View key={label} style={{ gap: 10 }}><SectionTitle>{label}</SectionTitle>{values.map((test) => <TestCard key={test._id} test={test} onOpen={() => openInstructions(test)} busy={busy} />)}</View> : null)}
      {!tests.length ? <Empty message="No tests are assigned to your batch." /> : null}
    </> : null}

    {section === 'Results' ? <>
      {pendingResults.length ? <><SectionTitle>Submitted — Result Pending</SectionTitle>{pendingResults.map((item) => <PendingResultCard key={item.submission.id} item={item} />)}</> : null}
      <SectionTitle>My results</SectionTitle>
      {results.length ? results.map((result) => <ResultCard key={result._id} result={result} />) : <Empty message="No results available." />}
    </> : null}

    {section === 'Alerts' ? <>
      <SectionTitle>Notifications</SectionTitle>
      {notifications.length ? notifications.map((item) => <Card key={item._id}><Row><Badge tone={item.type === 'error' ? 'danger' : item.type === 'warning' ? 'warning' : 'primary'}>{item.type || 'info'}</Badge><Body muted>{new Date(item.createdAt).toLocaleString()}</Body></Row><Text selectable style={{ color: colors.label, fontWeight: '800', fontSize: 16 }}>{item.title || 'Notification'}</Text><Body>{item.message || ''}</Body>{item.link ? <Button title="Open" variant="secondary" compact onPress={() => openNotification(item.link)} /> : null}</Card>) : <Empty message="No notifications." />}
    </> : null}

    {section === 'Documents' ? <>
      <Card>
        <SectionTitle>Upload document</SectionTitle>
        <Body muted>PDF, JPG or PNG up to the server file-size limit.</Body>
        <Field label="Description (optional)" value={description} onChangeText={setDescription} placeholder="e.g. Birth certificate" />
        <Button title="Select & Upload" onPress={uploadDocument} busy={busy} />
      </Card>
      <SectionTitle>My documents</SectionTitle>
      {documents.length ? documents.map((document) => <Card key={document._id}><DataLine label="File" value={document.originalName} /><Body muted>{document.description || document.fileType}</Body><Button title="Open Document" variant="secondary" compact onPress={() => { const url = assetUrl(document.filePath); if (url) Linking.openURL(url); }} /></Card>) : <Empty message="No documents uploaded." />}
    </> : null}

    {section === 'Account' ? <Card>
      <DataLine label="Name" value={user.name} />
      <DataLine label="Roll Number" value={user.rollNo || '—'} />
      <DataLine label="Email" value={user.email || '—'} />
      <Button title="Change Password" variant="secondary" onPress={() => router.push('/change-password')} />
      <Button title="Logout" variant="danger" onPress={() => Alert.alert('Logout?', 'You will need to sign in again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Logout', style: 'destructive', onPress: async () => { await logout(); router.replace('/login'); } }])} />
    </Card> : null}
  </Screen>;
}

function TestCard({ test, onOpen, busy }: { test: MobileTest; onOpen: () => void; busy: boolean }) {
  const completed = Boolean(test.result && ['submitted', 'auto_submitted'].includes(test.result.status || ''));
  const timing = test.timingMode === 'UNTIMED' ? 'No time limit' : test.timingMode === 'FIXED_WINDOW' ? 'Fixed window' : `${test.duration} min personal`;
  const pendingRelease = completed && test.result?.released === false;
  return <Card><Row><Badge tone={test.status === 'closed' ? 'warning' : pendingRelease ? 'warning' : 'primary'}>{pendingRelease ? 'result pending' : test.status}</Badge><Body muted>{timing} · {test.totalMarks} marks</Body></Row><Text selectable style={{ color: colors.label, fontSize: 17, fontWeight: '900' }}>{test.title}</Text><Body muted>{test.subject?.join(', ') || 'General'}</Body><Button title={completed ? pendingRelease ? 'View Submission' : 'View Result' : test.result?.status === 'in_progress' ? 'Resume Test' : 'Instructions'} onPress={onOpen} busy={busy} /></Card>;
}

function PendingResultCard({ item }: { item: PendingReleaseItem }) {
  return <Card><Row><Badge tone="warning">Result Pending</Badge><Body muted>{item.submission.submittedAt ? new Date(item.submission.submittedAt).toLocaleDateString() : ''}</Body></Row><Text selectable style={{ color: colors.label, fontSize: 17, fontWeight: '900' }}>{item.submission.testTitle}</Text><Body muted>{item.release.message}</Body><Button title="View Submission" variant="secondary" compact onPress={() => router.push({ pathname:'/result/[result-id]', params:{ 'result-id':item.submission.id } })} /></Card>;
}

function ResultCard({ result }: { result: MobileResult }) {
  const testId = typeof result.testId === 'object' ? result.testId?._id : undefined;
  return <Card><Row><Badge>{result.rank ? `Rank ${result.rank}` : 'Result'}</Badge><Body muted>{result.submittedAt ? new Date(result.submittedAt).toLocaleDateString() : ''}</Body></Row><Text selectable style={{ color: colors.label, fontSize: 17, fontWeight: '900' }}>{result.testId?.title || 'Exam Result'}</Text><Body>{result.score} / {result.totalMarks} marks</Body><Row><View style={{ flex: 1 }}><Button title="View Detail" variant="secondary" compact onPress={() => router.push({ pathname: '/result/[result-id]', params: { 'result-id': result._id } })} /></View>{testId ? <View style={{ flex: 1 }}><Button title="Leaderboard" variant="ghost" compact onPress={() => router.push({ pathname: '/leaderboard/[test-id]', params: { 'test-id': testId } })} /></View> : null}</Row></Card>;
}

function InstructionsCard({ value, accessPassword, onAccessPasswordChange, onUnlock, onClose, onStart, busy }: { value: TestInstructions; accessPassword: string; onAccessPasswordChange: (value: string) => void; onUnlock: () => void; onClose: () => void; onStart: () => void; busy: boolean }) {
  return <Card><Row><Badge tone={value.availability === 'expired' ? 'danger' : value.availability === 'upcoming' ? 'warning' : 'primary'}>{value.availability.replace('_', ' ')}</Badge><Pressable onPress={onClose}><Text style={{ color: colors.primary, fontWeight: '800' }}>Close</Text></Pressable></Row><Title>{value.test.title}</Title><Body>{value.test.instructions || 'Read every question carefully. Save each answer before moving.'}</Body><DataLine label="Timing" value={value.timingLabel} /><DataLine label="Questions" value={value.questionCount} /><DataLine label="Total Marks" value={value.test.totalMarks} /><DataLine label="Negative Marking" value={value.test.negativeMarking ?? 0} />{value.cetSectionFlow ? <><SectionTitle>Section order</SectionTitle>{value.sectionSummary.map((section) => <DataLine key={section.subject} label={section.subject} value={`${section.questionCount} questions · ${section.totalMarks} marks`} />)}</> : null}{value.submittedResultId ? <Button title="View Submitted Result" onPress={() => router.push({ pathname: '/result/[result-id]', params: { 'result-id': String(value.submittedResultId) } })} /> : value.requiresAccess ? <><Field label="Test Password / PIN" value={accessPassword} onChangeText={onAccessPasswordChange} secureTextEntry autoCapitalize="none" /><Button title="Verify Access" onPress={onUnlock} disabled={accessPassword.length < 4} busy={busy} /></> : <Button title={value.inProgress ? 'Resume Exam' : 'Start Exam'} onPress={onStart} disabled={!value.canStart} />}</Card>;
}
