import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://spvn.aparaitech.org/api/mobile').replace(/\/$/, '');
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/mobile$/, '');

const TOKEN_KEY = 'spvn_mobile_access_token';
let accessToken = '';
const testAccessTokens = new Map<string, string>();

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
  }
}

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError('Network connection failed. Check internet and server URL.', 0, 'NETWORK_ERROR');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || `Request failed (${response.status}).`, response.status, body.code, body);
  return body as T;
};

const query = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
  return entries.length ? `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')}` : '';
};

const saveToken = async (token: string) => {
  accessToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

export const assetUrl = (value?: string | null) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
};

export const mobileApi = {
  async login(identifier: string, password: string, role: MobileUser['role']) {
    const session = await request<MobileSession>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password, role }) });
    await saveToken(session.token);
    return session;
  },
  async restoreSession() {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return null;
    accessToken = token;
    try {
      return await request<{ user: MobileUser }>('/me');
    } catch {
      accessToken = '';
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      return null;
    }
  },
  async clearSession() {
    accessToken = '';
    testAccessTokens.clear();
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
  async changePassword(payload: { currentPassword: string; newPassword: string; confirmPassword: string }) {
    const response = await request<{ user: MobileUser; token: string }>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) });
    await saveToken(response.token);
    return response;
  },
  getMeta: () => request<MobileMeta>('/meta'),
  download: async (path: string, fileName: string) => {
    if (!FileSystem.cacheDirectory) throw new ApiError('Downloads are unavailable on this device.', 0);
    const result = await FileSystem.downloadAsync(`${API_BASE_URL}${path}`, `${FileSystem.cacheDirectory}${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (result.status < 200 || result.status >= 300) throw new ApiError(`Download failed (${result.status}).`, result.status);
    return result.uri;
  },

  getStudentDashboard: () => request<StudentDashboard>('/student/dashboard'),
  getStudentTests: () => request<{ tests: MobileTest[] }>('/student/tests'),
  getStudentInstructions: (testId: string) => request<TestInstructions>(`/student/tests/${testId}/instructions`),
  async unlockStudentTest(testId: string, testAccessPassword: string) {
    const response = await request<{ accessToken: string | null; required: boolean }>(`/student/tests/${testId}/unlock`, { method:'POST', body:JSON.stringify({ testAccessPassword }) });
    if (response.accessToken) testAccessTokens.set(testId, response.accessToken);
    return response;
  },
  getStudentResults: () => request<{ results: MobileResult[]; pendingResults: PendingReleaseItem[] }>('/student/results'),
  getResult: (resultId: string) => request<ResultDetail>(`/results/${resultId}`),
  getLeaderboard: (testId: string) => request<Leaderboard>(`/tests/${testId}/leaderboard`),
  downloadResult: (resultId: string) => mobileApi.download(`/results/${resultId}/pdf`, `result_${resultId}.pdf`),
  getStudentNotifications: () => request<{ notifications: MobileNotification[] }>('/student/notifications'),
  getStudentDocuments: () => request<{ documents: MobileDocument[] }>('/student/documents'),
  uploadStudentDocument: (document: FormData) => request<{ document: MobileDocument }>('/student/documents', { method: 'POST', body: document }),
  startStudentTest: (testId: string) => request<{ resultId: string; firstQuestionNumber: number; questionCount: number }>(`/student/tests/${testId}/start`, { method: 'POST', body:JSON.stringify({ accessToken:testAccessTokens.get(testId) || null }) }),
  getStudentQuestion: (testId: string, questionNumber: number) => request<ExamQuestionState>(`/student/tests/${testId}/questions/${questionNumber}`),
  saveStudentAnswer: (testId: string, payload: ExamAnswerPayload) => request<{ saved: boolean; answeredCount: number }>(`/student/tests/${testId}/answers`, { method: 'POST', body: JSON.stringify(payload) }),
  leaveStudentTest: (testId: string, payload: ExamAnswerPayload) => request<{ saved: boolean }>(`/student/tests/${testId}/leave`, { method: 'POST', body: JSON.stringify(payload) }),
  reportViolation: (testId: string, type: 'tabSwitch' | 'focusLoss' | 'fullscreenExit') => request<ViolationResponse>(`/student/tests/${testId}/violations`, { method: 'POST', body: JSON.stringify({ type }) }),
  submitStudentTest: (testId: string, auto = false) => request<SubmitResultResponse>(`/student/tests/${testId}/submit`, { method: 'POST', body: JSON.stringify({ auto }) }),

  getAdminDashboard: () => request<AdminDashboard>('/admin/dashboard'),
  getAdminStudents: (search = '') => request<{ students: MobileAdminStudent[]; groups: MobileAdminGroup[] }>(`/admin/students${query({ search })}`),
  getAdminStudent: (studentId: string) => request<AdminStudentDetail>(`/admin/students/${studentId}`),
  createAdminStudent: (payload: Partial<MobileAdminStudent> & { name: string; rollNo: string; groupId?: string }) => request<{ student: MobileAdminStudent; initialPassword: string }>('/admin/students', { method: 'POST', body: JSON.stringify(payload) }),
  bulkImportAdminStudents: (data: FormData) => request<BulkImportResult>('/admin/students/bulk-import', { method: 'POST', body: data }),
  deleteAdminStudent: (studentId: string) => request<void>(`/admin/students/${studentId}`, { method: 'DELETE' }),
  downloadStudentTemplate: () => mobileApi.download('/admin/students/template', 'student_import_template.xlsx'),

  getAdminGroups: () => request<{ groups: MobileAdminGroup[] }>('/admin/groups'),
  getAdminGroup: (groupId: string) => request<AdminGroupDetail>(`/admin/groups/${groupId}`),
  createAdminGroup: (payload: Partial<MobileAdminGroup> & { name: string }) => request<{ group: MobileAdminGroup }>('/admin/groups', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminGroup: (groupId: string, payload: Partial<MobileAdminGroup>) => request<{ group: MobileAdminGroup }>(`/admin/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAdminGroup: (groupId: string) => request<void>(`/admin/groups/${groupId}`, { method: 'DELETE' }),
  assignAdminGroupMember: (groupId: string, studentId: string) => request<{ assigned: boolean }>(`/admin/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ studentId }) }),
  removeAdminGroupMember: (groupId: string, studentId: string) => request<void>(`/admin/groups/${groupId}/members/${studentId}`, { method: 'DELETE' }),
  moveAdminGroupMember: (groupId: string, studentId: string, targetGroupId: string) => request<{ moved: boolean }>(`/admin/groups/${groupId}/members/${studentId}/move`, { method: 'POST', body: JSON.stringify({ targetGroupId }) }),
  downloadGroupCredentials: (groupId: string) => mobileApi.download(`/admin/groups/${groupId}/credentials`, `batch_${groupId}_credentials.pdf`),

  getAdminTopics: (course = '', subject = '') => request<{ topics: MobileTopic[] }>(`/admin/topics${query({ course, subject })}`),
  createAdminTopic: (payload: TopicPayload) => request<{ topic: MobileTopic }>('/admin/topics', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminTopic: (topicId: string, payload: Partial<TopicPayload>) => request<{ topic: MobileTopic }>(`/admin/topics/${topicId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAdminTopic: (topicId: string) => request<void>(`/admin/topics/${topicId}`, { method: 'DELETE' }),
  importAdminSyllabus: (data: FormData) => request<{ created: number; updated: number; warnings: string[]; model: string }>('/admin/topics/import-pdf', { method: 'POST', body: data }),

  getAdminQuestions: (filters: QuestionFilters = {}) => request<QuestionPage>(`/admin/questions${query(filters)}`),
  getAdminQuestion: (questionId: string) => request<{ question: MobileQuestion }>(`/admin/questions/${questionId}`),
  createAdminQuestion: (payload: QuestionPayload) => request<{ question: MobileQuestion }>('/admin/questions', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminQuestion: (questionId: string, payload: Partial<QuestionPayload>) => request<{ question: MobileQuestion }>(`/admin/questions/${questionId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAdminQuestion: (questionId: string) => request<void>(`/admin/questions/${questionId}`, { method: 'DELETE' }),
  bulkImportAdminQuestions: (data: FormData) => request<{ created: number; skipped: number }>('/admin/questions/bulk-import', { method: 'POST', body: data }),
  downloadQuestionTemplate: () => mobileApi.download('/admin/questions/template', 'question_import_template.xlsx'),
  scanAdminQuestions: (data: FormData) => request<{ draft: SmartScanDraft }>('/admin/smart-scanner/scan', { method: 'POST', body: data }),
  getSmartScanDraft: (draftId: string) => request<{ draft: SmartScanDraft }>(`/admin/smart-scanner/${draftId}`),
  commitSmartScan: (draftId: string, questions: SmartScanQuestion[]) => request<{ imported: number; questionIds: string[] }>(`/admin/smart-scanner/${draftId}/commit`, { method: 'POST', body: JSON.stringify({ questions }) }),
  discardSmartScan: (draftId: string) => request<void>(`/admin/smart-scanner/${draftId}`, { method: 'DELETE' }),

  getAdminTests: (course = '', subject = '') => request<{ tests: MobileAdminTest[] }>(`/admin/tests${query({ course, subject })}`),
  getAdminTest: (testId: string) => request<{ test: MobileAdminTest; resultCount: number }>(`/admin/tests/${testId}`),
  createAdminTest: (payload: TestPayload) => request<{ test: MobileAdminTest }>('/admin/tests', { method: 'POST', body: JSON.stringify(payload) }),
  uploadAdminPdfTest: (data: FormData) => request<{ test: MobileAdminTest; pageCount: number }>('/admin/tests/upload-pdf', { method: 'POST', body: data }),
  updateAdminTest: (testId: string, payload: Partial<TestPayload>) => request<{ test: MobileAdminTest }>(`/admin/tests/${testId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  publishAdminTest: (testId: string) => request<{ test: MobileAdminTest; notifiedStudents: number }>(`/admin/tests/${testId}/publish`, { method: 'POST' }),
  releaseAdminTestResults: (testId: string) => request<{ test: MobileAdminTest; notifiedStudents: number }>(`/admin/tests/${testId}/results/release`, { method:'POST' }),
  deleteAdminTest: (testId: string) => request<void>(`/admin/tests/${testId}`, { method: 'DELETE' }),
  downloadPdfTestTemplate: () => mobileApi.download('/admin/tests/template/pdf', 'question_paper_template.pdf'),
  downloadAnswerKeyTemplate: () => mobileApi.download('/admin/tests/template/answer-key', 'answer_key_template.pdf'),

  getAdminResults: (groupId = '', testId = '') => request<AdminResultsResponse>(`/admin/results${query({ groupId, testId })}`),
  getAdminResult: (resultId: string) => request<ResultDetail>(`/admin/results/${resultId}`),
  downloadAdminResults: (groupId = '', testId = '') => mobileApi.download(`/admin/results/export${query({ groupId, testId })}`, 'exam_results.xlsx'),
  getAdminDocuments: () => request<{ documents: MobileAdminDocument[] }>('/admin/documents'),
  deleteAdminDocument: (documentId: string) => request<void>(`/admin/documents/${documentId}`, { method: 'DELETE' }),
};

export type MobileUser = { id: string; _id?: string; name: string; email: string | null; rollNo: string | null; role: 'student' | 'admin'; isFirstLogin: boolean; profilePhoto: string | null; phone?: string | null; parentContact?: string | null; isActive?: boolean };
export type MobileSession = { token: string; user: MobileUser };
export type MobileMeta = { courses: string[]; subjectsByCourse: Record<string, string[]>; allSubjects: string[]; topics: MobileTopic[] };
export type TimingMode = 'PERSONAL_DURATION' | 'FIXED_WINDOW' | 'UNTIMED';
export type ResultReleaseMode = 'IMMEDIATE' | 'AFTER_TEST_END' | 'SCHEDULED' | 'MANUAL';
export type QuestionType = 'SINGLE_CORRECT' | 'MULTIPLE_CORRECT' | 'NUMERICAL' | 'TRUE_FALSE';
export type OptionKey = 'A' | 'B' | 'C' | 'D';
export type ExamAnswer = string | string[] | number | null;
export type ReleaseState = { available: boolean; mode: ResultReleaseMode; releaseAt: string | null; message: string };
export type SubmissionSummary = { id: string; testId: string; testTitle: string; status: string; submittedAt: string | null };
export type PendingReleaseItem = { submission: SubmissionSummary; release: ReleaseState };
export type MobileSubmissionResult = { _id: string; status: string; submittedAt: string | null; released: false };
export type MobileTest = { _id: string; title: string; description?: string | null; instructions?: string | null; timingMode?: TimingMode; duration: number | null; totalMarks: number; subject: string[]; course?: string[]; startTime: string | null; endTime: string | null; status: string; negativeMarking?: number; resultReleaseMode?: ResultReleaseMode; resultReleaseAt?: string | null; resultsReleased?: boolean; result: MobileResult | MobileSubmissionResult | null };
export type MobileResult = { _id: string; released?: true; score: number; totalMarks: number; fullTotalMarks?: number; correctAnswers?: number; wrongAnswers?: number; partialAnswers?: number; bonusAnswers?: number; skippedAnswers?: number; rank: number | null; percentile?: number | null; timeTaken?: number | null; submittedAt: string | null; status?: string; subjectScores?: Record<string, SubjectScore>; topicScores?: Record<string, { correct: number; wrong: number; skipped: number }>; answers?: Record<string, { answer: ExamAnswer }>; perQuestionScore?: Record<string, { status: 'correct' | 'incorrect' | 'partial' | 'skipped' | 'bonus'; awarded: number; maxScore: number }>; questionOrder?: string[]; testId: MobileAdminTest | { _id?: string; title?: string; subject?: string[] } | null; studentId?: MobileAdminStudent };
export type SubjectScore = { correct: number; wrong: number; skipped: number; marks: number; total: number; status?: string };
export type MobileNotification = { _id: string; title?: string; message?: string; type?: string; isRead?: boolean; link?: string | null; createdAt: string };
export type MobileDocument = { _id: string; originalName: string; fileType: string; fileSize: number; filePath: string; description: string; createdAt: string };
export type StudentDashboard = { stats: { pending: number; completed: number; released: number; averageScore: number; accuracy: number; totalCorrect: number; totalAttempted: number; scoreTrend: 'up' | 'down' | 'neutral' }; pendingTests: MobileTest[]; recentResults: MobileResult[]; pendingReleases: PendingReleaseItem[]; notifications: MobileNotification[]; subjectStats: { name: string; marks: number; maxMarks: number; count: number; percentage: number }[]; chartData: { label: string; percentage: number; score: number; total: number; date: string | null }[] };
export type TestInstructions = { test: MobileTest; questionCount: number; inProgress: boolean; submittedResultId: string | null; resultReleased: boolean | null; release: ReleaseState | null; canStart: boolean; availability: 'completed' | 'in_progress' | 'upcoming' | 'expired' | 'available'; timingMode: TimingMode; timingLabel: string; requiresAccess: boolean; cetSectionFlow: boolean; sectionSummary: { subject: string; questionCount: number; totalMarks: number }[] };
export type ReleasedResultDetail = { released: true; result: MobileResult & { testId: MobileAdminTest & { questions: MobileQuestion[] }; studentId: MobileAdminStudent }; percentage: number; topperResult?: MobileResult; totalAttempted?: number; trend?: MobileResult[] };
export type PendingResultDetail = { released: false; submission: SubmissionSummary; release: ReleaseState };
export type ResultDetail = ReleasedResultDetail | PendingResultDetail;
export type SubmitResultResponse = ({ released:true; result:MobileResult } | { released:false; submission:SubmissionSummary; release:ReleaseState }) & { resultId:string };
export type Leaderboard = { test: MobileAdminTest; results: MobileResult[] };
export type AdminDashboard = { stats: { students: number; tests: number; groups: number; questions: number; submittedResults: number }; recentResults: MobileResult[]; recentUsers: MobileAdminStudent[] };
export type MobileAdminStudent = MobileUser & { _id: string; parentContact: string | null; phone?: string | null; isActive: boolean };
export type MobileAdminGroup = { _id: string; name: string; description: string | null; academicYear: string; course: string | null; members: MobileAdminStudent[] };
export type AdminStudentDetail = { student: MobileAdminStudent; groups: MobileAdminGroup[]; results: MobileResult[]; documents: MobileDocument[]; stats: { tests: number; averageScore: number } };
export type AdminGroupDetail = { group: MobileAdminGroup; members: MobileAdminStudent[]; availableStudents: MobileAdminStudent[]; otherGroups: MobileAdminGroup[] };
export type MobileTopic = { _id: string; name: string; course: string; subject: string; subtopics: string[]; isActive: boolean };
export type TopicPayload = { name: string; course: string; subject: string; subtopics: string[] | string };
export type MobileQuestion = { _id: string; question: string; questionImage?: string | null; questionType?: QuestionType; optionA: string; optionB: string; optionC: string; optionD: string; optionAImage?: string | null; optionBImage?: string | null; optionCImage?: string | null; optionDImage?: string | null; correctAnswer: OptionKey | null; correctAnswers?: OptionKey[]; numericalAnswer?: { value?: number | null; min?: number | null; max?: number | null; tolerance?: number | null } | null; subject: string; topic?: string | null; subtopic?: string | null; difficulty: 'Easy' | 'Medium' | 'Hard'; marks: number; explanation?: string | null };
export type QuestionPayload = { question:string; questionType:QuestionType; optionA:string; optionB:string; optionC:string; optionD:string; correctAnswer:OptionKey | null; correctAnswers:OptionKey[]; numericalValue?:number | null; numericalMin?:number | null; numericalMax?:number | null; numericalTolerance?:number; subject:string; topic?:string; subtopic?:string; difficulty:'Easy' | 'Medium' | 'Hard'; marks:number; explanation?:string };
export type QuestionFilters = { subject?: string; topic?: string; subtopic?: string; difficulty?: string; page?: number; limit?: number };
export type QuestionPage = { questions: MobileQuestion[]; total: number; page: number; totalPages: number };
export type MobileAdminTest = { _id: string; title: string; description?: string | null; status: string; timingMode?: TimingMode; duration: number | null; totalMarks: number; negativeMarking?: number; passingMarks?: number | null; instructions?: string | null; course?: string[]; subject?: string[]; topic?: string | null; subtopic?: string | null; startTime?: string | null; endTime?: string | null; resultReleaseMode?: ResultReleaseMode; resultReleaseAt?: string | null; resultsReleased?: boolean; groups: MobileAdminGroup[]; questions?: MobileQuestion[]; questionPdfPath?: string | null; solutionPdfPath?: string | null; shuffleQuestions?: boolean; shuffleOptions?: boolean; autoSubmitOnViolation?: boolean; maxTabSwitches?: number; maxFocusLosses?: number; blockCopyPaste?: boolean; requireFullscreen?: boolean; testAccessEnabled?: boolean };
export type TestPayload = { title: string; description?: string; timingMode: TimingMode; duration: number; negativeMarking: number; passingMarks?: number | null; questionIds: string[]; groupIds: string[]; course: string[]; subject: string[]; topic?: string; subtopic?: string; startTime?: string | null; endTime?: string | null; resultReleaseMode: ResultReleaseMode; resultReleaseAt?: string | null; instructions?: string; shuffleQuestions?: boolean; shuffleOptions?: boolean; autoSubmitOnViolation?: boolean; maxTabSwitches?: number; maxFocusLosses?: number; blockCopyPaste?: boolean; requireFullscreen?: boolean; testAccessEnabled?: boolean; testAccessPassword?: string };
export type MobileAdminDocument = MobileDocument & { studentId: MobileAdminStudent };
export type AdminResultsResponse = { results: MobileResult[]; groups: MobileAdminGroup[]; tests: MobileAdminTest[] };
export type BulkImportResult = { created: number; existing: number; assigned: number; skipped: number; duplicates: string[]; groupAssigned: boolean };
export type SmartScanQuestion = { question: string; optionA: string; optionB: string; optionC: string; optionD: string; correctAnswer: 'A' | 'B' | 'C' | 'D' | 'UNKNOWN'; subject: string; topic?: string; subtopic?: string; difficulty: 'Easy' | 'Medium' | 'Hard'; marks: number; explanation?: string; isSelected: boolean };
export type SmartScanDraft = { _id: string; status: 'scanning' | 'review' | 'imported' | 'failed'; questions: SmartScanQuestion[]; warnings: string[]; extractionMethod: string; extractionModel: string | null };
export type ExamAnswerPayload = { questionId: string; answer: ExamAnswer; markForReview: boolean; timeSpent: number };
export type ViolationResponse = { flags: { tabSwitches: number; fullscreenExits: number; focusLosses: number }; violations: number; autoSubmit: boolean };
export type ExamQuestionState = { questionNumber: number; totalQuestions: number; remainingSeconds: number | null; question: { id: string; question: string; questionImage: string | null; questionType: QuestionType; subject: string; topic: string | null; subtopic: string | null; marks: number; marking?: { positiveMarks:number; negativeMarks:number; partialMarks:number; markingMode:string }; options: { key: OptionKey; value: string; image: string | null }[] }; selectedAnswer: ExamAnswer; markedForReview: boolean; sections: { name: string; locked: boolean; questionNumbers: number[] }[]; palette: { number: number; answered: boolean; visited: boolean; marked: boolean }[] };
