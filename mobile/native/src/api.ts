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
      'Content-Type': 'application/json',
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
  startStudentTest: (testId: string) => request<{ resultId: string; firstQuestionNumber: number; questionCount: number }>(`/student/tests/${testId}/start`, { method: 'POST' }),
  getStudentQuestion: (testId: string, questionNumber: number) => request<ExamQuestionState>(`/student/tests/${testId}/questions/${questionNumber}`),
  saveStudentAnswer: (testId: string, payload: { questionId: string; answer: string | null; markForReview: boolean; timeSpent: number }) => request<{ saved: boolean; answeredCount: number }>(`/student/tests/${testId}/answers`, { method: 'POST', body: JSON.stringify(payload) }),
  submitStudentTest: (testId: string) => request<{ result: MobileResult }>(`/student/tests/${testId}/submit`, { method: 'POST' }),
  getAdminDashboard: () => request<AdminDashboard>('/admin/dashboard'),
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

export type StudentDashboard = {
  stats: { pending: number; completed: number; averageScore: number };
  pendingTests: MobileTest[];
  recentResults: MobileResult[];
  notifications: MobileNotification[];
};

export type AdminDashboard = {
  stats: { students: number; tests: number; submittedResults: number };
};

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
