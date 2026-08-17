export const API_BASE_URL = 'https://spvn.aparaitech.org/api/mobile';

export type MobileUser = {
  id: string;
  name: string;
  email: string | null;
  rollNo: string | null;
  role: 'student' | 'admin';
  isFirstLogin: boolean;
  profilePhoto: string | null;
};

export type MobileSession = {
  token: string;
  user: MobileUser;
};

let accessToken = '';

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body as T;
};

export const mobileApi = {
  async login(identifier: string, password: string, role: 'student' | 'admin') {
    const session = await request<MobileSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, role }),
    });
    accessToken = session.token;
    return session;
  },
  clearSession() {
    accessToken = '';
  },
  getStudentDashboard: () => request<StudentDashboard>('/student/dashboard'),
  getStudentTests: () => request<{ tests: MobileTest[] }>('/student/tests'),
  getStudentResults: () => request<{ results: MobileResult[] }>('/student/results'),
  getStudentNotifications: () => request<{ notifications: MobileNotification[] }>('/student/notifications'),
  getStudentDocuments: () => request<{ documents: MobileDocument[] }>('/student/documents'),
  uploadStudentDocument: (document: FormData) => request<{ document: MobileDocument }>('/student/documents', { method: 'POST', body: document }),
  startStudentTest: (testId: string) => request<{ resultId: string; firstQuestionNumber: number; questionCount: number }>(`/student/tests/${testId}/start`, { method: 'POST' }),
  getStudentQuestion: (testId: string, questionNumber: number) => request<ExamQuestionState>(`/student/tests/${testId}/questions/${questionNumber}`),
  saveStudentAnswer: (testId: string, payload: { questionId: string; answer: string | null; markForReview: boolean; timeSpent: number }) => request<{ saved: boolean; answeredCount: number }>(`/student/tests/${testId}/answers`, { method: 'POST', body: JSON.stringify(payload) }),
  submitStudentTest: (testId: string) => request<{ result: MobileResult }>(`/student/tests/${testId}/submit`, { method: 'POST' }),
  getAdminDashboard: () => request<AdminDashboard>('/admin/dashboard'),
  getAdminStudents: () => request<{ students: MobileAdminStudent[] }>('/admin/students'),
  getAdminGroups: () => request<{ groups: MobileAdminGroup[] }>('/admin/groups'),
  getAdminTests: () => request<{ tests: MobileAdminTest[] }>('/admin/tests'),
  getAdminResults: () => request<{ results: MobileAdminResult[] }>('/admin/results'),
  createAdminStudent: (payload: { name: string; rollNo: string; parentContact?: string; groupId?: string }) => request<{ student: MobileAdminStudent; initialPassword: string }>('/admin/students', { method: 'POST', body: JSON.stringify(payload) }),
  createAdminGroup: (payload: { name: string; description?: string; academicYear?: string; course?: string }) => request<{ group: MobileAdminGroup }>('/admin/groups', { method: 'POST', body: JSON.stringify(payload) }),
  bulkImportAdminStudents: (data: FormData) => request<{ created: number; skipped: number; duplicates: string[]; groupAssigned: boolean }>('/admin/students/bulk-import', { method: 'POST', body: data }),
  bulkImportAdminQuestions: (data: FormData) => request<{ created: number; skipped: number }>('/admin/questions/bulk-import', { method: 'POST', body: data }),
};

export type MobileTest = {
  _id: string;
  title: string;
  duration: number;
  totalMarks: number;
  subject: string[];
  startTime: string | null;
  endTime: string | null;
  status: string;
  result: MobileResult | null;
};

export type MobileResult = {
  _id: string;
  score: number;
  totalMarks: number;
  rank: number | null;
  submittedAt: string | null;
  testId: { title?: string; subject?: string[] } | null;
};

export type MobileNotification = {
  _id: string;
  title?: string;
  message?: string;
  createdAt: string;
};

export type MobileDocument = {
  _id: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  filePath: string;
  description: string;
  createdAt: string;
};

export type StudentDashboard = {
  stats: { pending: number; completed: number; averageScore: number };
  pendingTests: MobileTest[];
  recentResults: MobileResult[];
  notifications: MobileNotification[];
};

export type AdminDashboard = {
  stats: { students: number; tests: number; submittedResults: number };
};

export type MobileAdminStudent = Pick<MobileUser, 'id' | 'name' | 'rollNo' | 'email'> & { _id: string; parentContact: string | null; isActive: boolean };
export type MobileAdminGroup = { _id: string; name: string; description: string | null; academicYear: string; course: string | null; members: { _id: string; name: string; rollNo: string }[] };
export type MobileAdminTest = { _id: string; title: string; status: string; duration: number; totalMarks: number; groups: { _id: string; name: string }[] };
export type MobileAdminResult = { _id: string; score: number; totalMarks: number; rank: number | null; submittedAt: string; studentId: { name: string; rollNo: string }; testId: { title: string } };

export type ExamQuestionState = {
  questionNumber: number;
  totalQuestions: number;
  remainingSeconds: number;
  question: {
    id: string;
    question: string;
    questionImage: string | null;
    subject: string;
    topic: string | null;
    subtopic: string | null;
    marks: number;
    options: { key: 'A' | 'B' | 'C' | 'D'; value: string; image: string | null }[];
  };
  selectedAnswer: string | null;
  markedForReview: boolean;
  sections: { name: string; locked: boolean; questionNumbers: number[] }[];
  palette: { number: number; answered: boolean; visited: boolean; marked: boolean }[];
};
