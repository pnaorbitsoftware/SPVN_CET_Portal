import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AdminDashboard, ExamQuestionState, mobileApi, MobileAdminGroup, MobileAdminResult, MobileAdminStudent, MobileAdminTest, MobileDocument, MobileResult, MobileTest, MobileUser, StudentDashboard } from './src/api';

type Screen = 'home' | 'tests' | 'results' | 'more';

export default function App() {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [screen, setScreen] = useState<Screen>('home');

  if (!user) return <LoginScreen onLogin={setUser} />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.greeting}>Namaskar, {user.name}</Text>
          <Text style={styles.roleLabel}>{user.role === 'admin' ? 'Administrator' : user.rollNo || 'Student'}</Text>
        </View>
        <Pressable onPress={() => { mobileApi.clearSession(); setUser(null); }}><Text style={styles.logout}>Logout</Text></Pressable>
      </View>
      {user.role === 'student'
        ? <StudentArea screen={screen} />
        : <AdminArea screen={screen} />}
      <TabBar screen={screen} onChange={setScreen} role={user.role} />
    </SafeAreaView>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: MobileUser) => void }) {
  const [role, setRole] = useState<'student' | 'admin'>('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!identifier.trim() || !password) return Alert.alert('Login details required', 'Enter your credentials to continue.');
    try {
      setLoading(true);
      const session = await mobileApi.login(identifier, password, role);
      onLogin(session.user);
    } catch (error) {
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.loginPage}>
      <StatusBar style="light" />
      <View style={styles.brandBlock}>
        <Text style={styles.brandMark}>SPVN</Text>
        <Text style={styles.brandTitle}>CET Portal</Text>
        <Text style={styles.brandSubtitle}>Shardabai Pawar Vidyamandir & Vidyaniketan</Text>
      </View>
      <View style={styles.loginCard}>
        <View style={styles.roleToggle}>
          <Pressable style={[styles.roleButton, role === 'student' && styles.roleButtonActive]} onPress={() => setRole('student')}><Text style={[styles.roleButtonText, role === 'student' && styles.roleButtonTextActive]}>Student</Text></Pressable>
          <Pressable style={[styles.roleButton, role === 'admin' && styles.roleButtonActive]} onPress={() => setRole('admin')}><Text style={[styles.roleButtonText, role === 'admin' && styles.roleButtonTextActive]}>Admin</Text></Pressable>
        </View>
        <Text style={styles.inputLabel}>{role === 'student' ? 'Roll Number' : 'Email Address'}</Text>
        <TextInput style={styles.input} value={identifier} onChangeText={setIdentifier} autoCapitalize="none" placeholder={role === 'student' ? 'Enter roll number' : 'Enter email'} />
        <Text style={styles.inputLabel}>Password</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Enter password" />
        <Pressable style={styles.primaryButton} onPress={login} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Secure Login</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function StudentArea({ screen }: { screen: Screen }) {
  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null);
  const [tests, setTests] = useState<MobileTest[]>([]);
  const [results, setResults] = useState<MobileResult[]>([]);
  const [documents, setDocuments] = useState<MobileDocument[]>([]);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const load = screen === 'home' ? mobileApi.getStudentDashboard().then(setDashboard)
      : screen === 'tests' ? mobileApi.getStudentTests().then((data) => setTests(data.tests))
        : screen === 'results' ? mobileApi.getStudentResults().then((data) => setResults(data.results))
          : mobileApi.getStudentDocuments().then((data) => setDocuments(data.documents));
    load.catch((error) => Alert.alert('Unable to load', error.message)).finally(() => setLoading(false));
  }, [screen]);

  if (activeTestId) return <ExamScreen testId={activeTestId} onClose={() => setActiveTestId(null)} />;
  if (loading) return <Loading />;
  if (screen === 'tests') return <StudentTests tests={tests} onStart={setActiveTestId} />;
  if (screen === 'results') return <ListPage title="My Results" items={results.map((result) => ({ title: result.testId?.title || 'Test Result', detail: `${result.score}/${result.totalMarks} marks`, badge: result.rank ? `Rank ${result.rank}` : 'Result' }))} />;
  if (screen === 'more') return <StudentDocuments documents={documents} onRefresh={() => mobileApi.getStudentDocuments().then((data) => setDocuments(data.documents))} />;
  return <StudentDashboardView dashboard={dashboard} />;
}

function StudentDocuments({ documents, onRefresh }: { documents: MobileDocument[]; onRefresh: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const upload = async () => {
    const selection = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (selection.canceled) return;
    const file = selection.assets[0];
    const formData = new FormData();
    formData.append('document', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
    try {
      setUploading(true);
      await mobileApi.uploadStudentDocument(formData);
      await onRefresh();
      Alert.alert('Uploaded', 'Your document has been uploaded.');
    } catch (error) { Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setUploading(false); }
  };
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>My Documents</Text><Pressable style={styles.primaryButton} onPress={upload} disabled={uploading}>{uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Select & Upload Document</Text>}</Pressable>{documents.length ? documents.map((document) => <View key={document._id} style={styles.card}><Text style={styles.cardTitle}>{document.originalName}</Text><Text style={styles.muted}>{document.description || document.fileType}</Text></View>) : <Text style={styles.muted}>No documents uploaded.</Text>}</ScrollView>;
}

function StudentTests({ tests, onStart }: { tests: MobileTest[]; onStart: (testId: string) => void }) {
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>My Tests</Text>{tests.length ? tests.map((test) => <View key={test._id} style={styles.card}><Text style={styles.cardTitle}>{test.title}</Text><Text style={styles.muted}>{test.duration} min · {test.totalMarks} marks</Text><Pressable disabled={Boolean(test.result)} style={[styles.secondaryButton, test.result && styles.disabledButton]} onPress={() => onStart(test._id)}><Text style={styles.secondaryButtonText}>{test.result ? 'Completed' : 'Start Test'}</Text></Pressable></View>) : <Text style={styles.muted}>No tests available.</Text>}</ScrollView>;
}

function ExamScreen({ testId, onClose }: { testId: string; onClose: () => void }) {
  const [state, setState] = useState<ExamQuestionState | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [markedForReview, setMarkedForReview] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadQuestion = async (questionNumber: number) => {
    setLoading(true);
    try {
      const questionState = await mobileApi.getStudentQuestion(testId, questionNumber);
      setState(questionState);
      setSelectedAnswer(questionState.selectedAnswer);
      setMarkedForReview(questionState.markedForReview);
    } catch (error) {
      Alert.alert('Question unavailable', error instanceof Error ? error.message : 'Please try again.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    mobileApi.startStudentTest(testId).then((session) => loadQuestion(session.firstQuestionNumber)).catch((error) => Alert.alert('Unable to start test', error.message));
  }, [testId]);

  const saveAndMove = async (questionNumber: number) => {
    if (!state) return;
    try {
      await mobileApi.saveStudentAnswer(testId, { questionId: state.question.id, answer: selectedAnswer, markForReview: markedForReview, timeSpent: 0 });
      await loadQuestion(questionNumber);
    } catch (error) { Alert.alert('Save failed', error instanceof Error ? error.message : 'Please try again.'); }
  };

  const submit = () => Alert.alert('Submit test?', 'You cannot change answers after submission.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit', style: 'destructive', onPress: async () => { try { await mobileApi.submitStudentTest(testId); Alert.alert('Submitted', 'Your result is ready.'); onClose(); } catch (error) { Alert.alert('Submit failed', error instanceof Error ? error.message : 'Please try again.'); } } }]);

  if (loading || !state) return <Loading />;
  return <SafeAreaView style={styles.examPage}><View style={styles.examHeader}><Pressable onPress={onClose}><Text style={styles.backText}>Exit</Text></Pressable><Text style={styles.examCounter}>Q {state.questionNumber}/{state.totalQuestions}</Text><Pressable onPress={submit}><Text style={styles.submitText}>Submit</Text></Pressable></View><ScrollView contentContainerStyle={styles.content}><Text style={styles.subjectText}>{state.question.subject}</Text><Text style={styles.questionText}>{state.question.question}</Text>{state.question.options.map((option) => <Pressable key={option.key} style={[styles.option, selectedAnswer === option.key && styles.optionSelected]} onPress={() => setSelectedAnswer(option.key)}><Text style={styles.optionKey}>{option.key}</Text><Text style={styles.optionValue}>{option.value}</Text></Pressable>)}<View style={styles.palette}>{state.palette.map((item) => <Pressable key={item.number} onPress={() => saveAndMove(item.number)} style={[styles.paletteItem, item.answered && styles.paletteAnswered, item.marked && styles.paletteMarked]}><Text>{item.number}</Text></Pressable>)}</View><View style={styles.examActions}><Pressable style={styles.secondaryButton} onPress={() => setMarkedForReview(!markedForReview)}><Text style={styles.secondaryButtonText}>{markedForReview ? 'Unmark' : 'Mark for Review'}</Text></Pressable><Pressable style={styles.primaryButton} onPress={() => saveAndMove(Math.min(state.questionNumber + 1, state.totalQuestions))}><Text style={styles.primaryButtonText}>{state.questionNumber === state.totalQuestions ? 'Save Answer' : 'Save & Next'}</Text></Pressable></View></ScrollView></SafeAreaView>;
}

function AdminArea({ screen }: { screen: Screen }) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [students, setStudents] = useState<MobileAdminStudent[]>([]);
  const [groups, setGroups] = useState<MobileAdminGroup[]>([]);
  const [tests, setTests] = useState<MobileAdminTest[]>([]);
  const [results, setResults] = useState<MobileAdminResult[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshManagement = async () => {
    const [studentData, groupData] = await Promise.all([mobileApi.getAdminStudents(), mobileApi.getAdminGroups()]);
    setStudents(studentData.students);
    setGroups(groupData.groups);
  };
  useEffect(() => {
    setLoading(true);
    const load = screen === 'home' ? mobileApi.getAdminDashboard().then(setDashboard)
      : screen === 'tests' ? mobileApi.getAdminTests().then((data) => setTests(data.tests))
        : screen === 'results' ? mobileApi.getAdminResults().then((data) => setResults(data.results))
          : Promise.all([mobileApi.getAdminStudents(), mobileApi.getAdminGroups()]).then(([studentData, groupData]) => { setStudents(studentData.students); setGroups(groupData.groups); });
    load.catch((error) => Alert.alert('Unable to load', error.message)).finally(() => setLoading(false));
  }, [screen]);
  if (loading) return <Loading />;
  if (screen === 'tests') return <ListPage title="Test Manager" items={tests.map((test) => ({ title: test.title, detail: `${test.duration} min · ${test.totalMarks} marks`, badge: test.status }))} />;
  if (screen === 'results') return <ListPage title="Results Manager" items={results.map((result) => ({ title: `${result.studentId?.name || 'Student'} · ${result.testId?.title || 'Test'}`, detail: `${result.score}/${result.totalMarks} marks`, badge: result.rank ? `Rank ${result.rank}` : '' }))} />;
  if (screen === 'more') return <AdminManagement students={students} groups={groups} onSaved={refreshManagement} />;
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>Admin Dashboard</Text><View style={styles.statsRow}><StatCard value={dashboard?.stats.students || 0} label="Students" /><StatCard value={dashboard?.stats.tests || 0} label="Tests" /><StatCard value={dashboard?.stats.submittedResults || 0} label="Results" /></View><Text style={styles.sectionTitle}>Management</Text><Text style={styles.muted}>Students, groups, question bank, syllabus, tests, imports and results are available in the native modules.</Text></ScrollView>;
}

function AdminManagement({ students, groups, onSaved }: { students: MobileAdminStudent[]; groups: MobileAdminGroup[]; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<'none' | 'student' | 'group'>('none');
  const [name, setName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [contact, setContact] = useState('');
  const [batchName, setBatchName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const [selectedFileName, setSelectedFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    try {
      setSaving(true);
      if (mode === 'student') {
        const response = await mobileApi.createAdminStudent({ name, rollNo, parentContact: contact });
        Alert.alert('Student added', `Temporary password: ${response.initialPassword}`);
      } else if (mode === 'group') {
        await mobileApi.createAdminGroup({ name: batchName });
        Alert.alert('Batch created', 'You can now assign students to this batch.');
      }
      setName(''); setRollNo(''); setContact(''); setBatchName(''); setMode('none');
      await onSaved();
    } catch (error) { Alert.alert('Save failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setSaving(false); }
  };
  const bulkImportStudents = async () => {
    const selection = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (selection.canceled) return;
    const file = selection.assets[0];
    setSelectedFileName(file.name);
    const formData = new FormData();
    formData.append('csvFile', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
    if (selectedGroupId) formData.append('groupId', selectedGroupId);
    try {
      setSaving(true);
      const result = await mobileApi.bulkImportAdminStudents(formData);
      Alert.alert('Import complete', `${result.created} students imported; ${result.skipped} skipped.${result.groupAssigned ? ' Added to selected batch.' : ''}`);
      await onSaved();
    } catch (error) { Alert.alert('Import failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setSaving(false); }
  };
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>Students & Batches</Text><View style={styles.managementButtons}><Pressable style={styles.primaryButton} onPress={() => setMode(mode === 'student' ? 'none' : 'student')}><Text style={styles.primaryButtonText}>Add Student</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => setMode(mode === 'group' ? 'none' : 'group')}><Text style={styles.secondaryButtonText}>Create Batch</Text></Pressable></View><View style={styles.formCard}><Text style={styles.sectionTitle}>Bulk Student Upload</Text><Text style={styles.muted}>Select a batch, then select Excel/CSV. Imported students are added to that batch.</Text><View style={styles.groupChoices}>{groups.map((group) => <Pressable key={group._id} style={[styles.groupChoice, selectedGroupId === group._id && styles.groupChoiceActive]} onPress={() => setSelectedGroupId(group._id)}><Text style={selectedGroupId === group._id ? styles.groupChoiceTextActive : styles.groupChoiceText}>{group.name}</Text></Pressable>)}</View>{selectedFileName ? <Text style={styles.fileSelected}>Selected: {selectedFileName}</Text> : null}<Pressable style={styles.primaryButton} onPress={bulkImportStudents} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Select File & Import</Text>}</Pressable></View>{mode === 'student' ? <View style={styles.formCard}><Text style={styles.sectionTitle}>New Student</Text><TextInput style={styles.input} placeholder="Student name" value={name} onChangeText={setName} /><TextInput style={styles.input} placeholder="Roll number" value={rollNo} onChangeText={setRollNo} autoCapitalize="characters" /><TextInput style={styles.input} placeholder="Parent contact (optional)" value={contact} onChangeText={setContact} keyboardType="phone-pad" /><Pressable style={styles.primaryButton} onPress={submit} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save Student</Text>}</Pressable></View> : null}{mode === 'group' ? <View style={styles.formCard}><Text style={styles.sectionTitle}>New Batch</Text><TextInput style={styles.input} placeholder="Batch name" value={batchName} onChangeText={setBatchName} /><Pressable style={styles.primaryButton} onPress={submit} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save Batch</Text>}</Pressable></View> : null}<Text style={styles.sectionTitle}>Students ({students.length})</Text>{students.slice(0, 10).map((student) => <View key={student._id} style={styles.card}><Text style={styles.cardTitle}>{student.name}</Text><Text style={styles.muted}>{student.rollNo || 'No roll number'}</Text></View>)}<Text style={styles.sectionTitle}>Batches ({groups.length})</Text>{groups.map((group) => <View key={group._id} style={styles.card}><Text style={styles.cardTitle}>{group.name}</Text><Text style={styles.muted}>{group.members.length} students · {group.course || 'All courses'}</Text></View>)}</ScrollView>;
}

function StudentDashboardView({ dashboard }: { dashboard: StudentDashboard | null }) {
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>My Dashboard</Text><View style={styles.statsRow}><StatCard value={dashboard?.stats.pending || 0} label="Pending" /><StatCard value={dashboard?.stats.completed || 0} label="Completed" /><StatCard value={`${dashboard?.stats.averageScore || 0}%`} label="Average" /></View><Text style={styles.sectionTitle}>Upcoming Tests</Text>{dashboard?.pendingTests.length ? dashboard.pendingTests.map((test) => <View key={test._id} style={styles.card}><Text style={styles.cardTitle}>{test.title}</Text><Text style={styles.muted}>{test.duration} minutes · {test.totalMarks} marks</Text></View>) : <Text style={styles.muted}>No tests available right now.</Text>}</ScrollView>;
}

function ListPage({ title, items }: { title: string; items: { title: string; detail: string; badge: string }[] }) {
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.pageTitle}>{title}</Text>{items.length ? items.map((item, index) => <View key={`${item.title}-${index}`} style={styles.card}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.muted}>{item.detail}</Text>{item.badge ? <Text style={styles.badge}>{item.badge}</Text> : null}</View>) : <Text style={styles.muted}>No records available.</Text>}</ScrollView>;
}

function TabBar({ screen, onChange, role }: { screen: Screen; onChange: (screen: Screen) => void; role: MobileUser['role'] }) {
  const labels: { screen: Screen; label: string }[] = [{ screen: 'home', label: 'Home' }, { screen: 'tests', label: role === 'admin' ? 'Tests' : 'Tests' }, { screen: 'results', label: 'Results' }, { screen: 'more', label: 'More' }];
  return <View style={styles.tabBar}>{labels.map((tab) => <Pressable key={tab.screen} style={styles.tab} onPress={() => onChange(tab.screen)}><Text style={[styles.tabText, screen === tab.screen && styles.tabTextActive]}>{tab.label}</Text></Pressable>)}</View>;
}

function Loading() { return <View style={styles.loading}><ActivityIndicator size="large" color="#075c36" /></View>; }
function StatCard({ value, label }: { value: string | number; label: string }) { return <View style={styles.statCard}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }

const styles: any = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f3f7f4' }, managementButtons: { flexDirection: 'row', gap: 8 }, formCard: { backgroundColor: '#fff', padding: 16, borderRadius: 16 }, examPage: { flex: 1, backgroundColor: '#f3f7f4' }, examHeader: { backgroundColor: '#075c36', padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, backText: { color: '#d9eee2', fontWeight: '800' }, submitText: { color: '#f7d75c', fontWeight: '900' }, examCounter: { color: '#fff', fontWeight: '800' }, subjectText: { color: '#075c36', fontWeight: '900', textTransform: 'uppercase' }, questionText: { color: '#1d3425', fontSize: 18, lineHeight: 27, fontWeight: '700' }, option: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: '#d7e2da', backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center' }, optionSelected: { borderColor: '#075c36', backgroundColor: '#e8f6ed' }, optionKey: { color: '#075c36', fontWeight: '900' }, optionValue: { color: '#253c2d', flex: 1 }, palette: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }, paletteItem: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e2e9e4', justifyContent: 'center', alignItems: 'center' }, paletteAnswered: { backgroundColor: '#9de2b5' }, paletteMarked: { backgroundColor: '#f7d75c' }, examActions: { gap: 10, marginTop: 8 }, secondaryButton: { borderWidth: 1, borderColor: '#075c36', padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 }, secondaryButtonText: { color: '#075c36', fontWeight: '800' }, disabledButton: { opacity: 0.5 }, loginPage: { flex: 1, backgroundColor: '#075c36', justifyContent: 'center', padding: 22 }, brandBlock: { alignItems: 'center', marginBottom: 28 }, brandMark: { color: '#d6ab28', fontSize: 44, fontWeight: '900', letterSpacing: 3 }, brandTitle: { color: '#fff', fontSize: 30, fontWeight: '800' }, brandSubtitle: { color: '#d9eee2', textAlign: 'center', marginTop: 8 }, loginCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20 }, roleToggle: { flexDirection: 'row', backgroundColor: '#edf4ef', borderRadius: 12, padding: 4, marginBottom: 20 }, roleButton: { flex: 1, padding: 11, alignItems: 'center', borderRadius: 9 }, roleButtonActive: { backgroundColor: '#075c36' }, roleButtonText: { color: '#4f6256', fontWeight: '700' }, roleButtonTextActive: { color: '#fff' }, inputLabel: { color: '#24372b', fontWeight: '700', marginBottom: 7 }, input: { borderWidth: 1, borderColor: '#d7e2da', borderRadius: 12, padding: 13, marginBottom: 16, fontSize: 16 }, primaryButton: { backgroundColor: '#075c36', padding: 15, borderRadius: 12, alignItems: 'center', minHeight: 52 }, primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' }, appHeader: { backgroundColor: '#075c36', padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, greeting: { color: '#fff', fontSize: 18, fontWeight: '800' }, roleLabel: { color: '#d9eee2', marginTop: 3 }, logout: { color: '#f7d75c', fontWeight: '800' }, content: { padding: 18, gap: 12, paddingBottom: 28 }, pageTitle: { color: '#123c26', fontSize: 25, fontWeight: '800', marginBottom: 4 }, statsRow: { flexDirection: 'row', gap: 8 }, statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14, alignItems: 'center', shadowColor: '#163725', shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 }, statValue: { color: '#075c36', fontSize: 22, fontWeight: '900' }, statLabel: { color: '#5f7165', marginTop: 4, fontSize: 12 }, sectionTitle: { marginTop: 10, color: '#123c26', fontSize: 18, fontWeight: '800' }, card: { backgroundColor: '#fff', padding: 16, borderRadius: 16, gap: 5 }, cardTitle: { color: '#173b27', fontSize: 16, fontWeight: '800' }, muted: { color: '#617268', lineHeight: 20 }, badge: { color: '#075c36', fontWeight: '800', marginTop: 3 }, tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#dce7df', paddingVertical: 8 }, tab: { flex: 1, alignItems: 'center', paddingVertical: 7 }, tabText: { color: '#6c7b70', fontSize: 12, fontWeight: '700' }, tabTextActive: { color: '#075c36' }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f7f4' },
});

Object.assign(styles, {
  groupChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  groupChoice: { borderWidth: 1, borderColor: '#b4c7b9', borderRadius: 18, paddingVertical: 7, paddingHorizontal: 10 },
  groupChoiceActive: { backgroundColor: '#075c36', borderColor: '#075c36' },
  groupChoiceText: { color: '#385142', fontWeight: '700' },
  groupChoiceTextActive: { color: '#fff', fontWeight: '700' },
  fileSelected: { color: '#075c36', fontWeight: '700', marginBottom: 8 },
});
