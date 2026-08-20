# Web → Native Route Parity

Every web action is represented either by a protected JSON/download route or by a native-only client action. All mobile API routes are under `/api/mobile`.

## Authentication and student portal

| Web route/action | Mobile API/native counterpart |
|---|---|
| `GET/POST /auth/login`, `GET/POST /auth/admin` | `POST /auth/login` + native role selector |
| `GET/POST /auth/change-password` | `POST /auth/change-password` + change-password sheet |
| `GET /auth/logout` | SecureStore token deletion + native logout |
| `GET /student/dashboard` | `GET /student/dashboard` |
| `GET /student/tests` | `GET /student/tests` + native availability categories |
| `GET /student/results` | `GET /student/results` |
| `GET /student/notifications` | `GET /student/notifications` |
| `GET/POST /student/documents` | `GET/POST /student/documents` + native picker/viewer |
| `GET /exam/:testId/instructions` | `GET /student/tests/:testId/instructions` |
| `POST /exam/:testId/start` | `POST /student/tests/:testId/start` |
| `GET /exam/:testId/question/:qNum` | `GET /student/tests/:testId/questions/:questionNumber` |
| `POST /exam/:testId/save-answer` | `POST /student/tests/:testId/answers` |
| `POST /exam/:testId/report-violation` | `POST /student/tests/:testId/violations` + AppState tracking |
| `POST /exam/:testId/submit` | `POST /student/tests/:testId/submit` |
| `GET /exam/:testId/auto-submit` | same submit route with `auto: true` from timer/violation flow |
| `POST /exam/:testId/leave` | `POST /student/tests/:testId/leave` |
| `GET /results/:resultId` | `GET /results/:resultId` + native review screen |
| `GET /results/:resultId/pdf` | `GET /results/:resultId/pdf` + authenticated download/share |
| `GET /results/leaderboard/:testId` | `GET /tests/:testId/leaderboard` |

## Administrator portal

| Web route/action | Mobile API/native counterpart |
|---|---|
| `GET /admin/dashboard` | `GET /admin/dashboard` |
| `GET/POST /admin/students` | `GET/POST /admin/students` |
| `POST /admin/students/bulk-import` | `POST /admin/students/bulk-import` |
| `GET /admin/students/:id/view` | `GET /admin/students/:studentId` |
| `POST /admin/students/:id/delete` | `DELETE /admin/students/:studentId` |
| `GET/POST /admin/groups` | `GET/POST /admin/groups` |
| `GET /admin/groups/template/download` | `GET /admin/students/template` |
| `POST /admin/groups/assign-member` | `POST /admin/groups/:groupId/members` |
| `GET/POST /admin/groups/:id` | `GET/PATCH /admin/groups/:groupId` |
| `POST /admin/groups/:id/delete` | `DELETE /admin/groups/:groupId` |
| `GET /admin/groups/:id/credentials-pdf` | `GET /admin/groups/:groupId/credentials` |
| `POST /admin/groups/:id/bulk-import` | student bulk import with `groupId` |
| `POST /admin/groups/:id/add-student` | student create with `groupId` |
| group member remove/move routes | matching `DELETE .../members/:studentId` and `POST .../move` routes |
| `GET/POST /admin/topics` | `GET/POST /admin/topics` |
| `POST /admin/topics/import-pdf` | `POST /admin/topics/import-pdf` |
| topic update/delete routes | `PATCH/DELETE /admin/topics/:topicId` |
| subject/topic/subtopic AJAX routes | `GET /meta`, `GET /admin/subjects/:course`, filtered topics |
| smart-import open/scan/review/commit/discard | native scanner + matching scan/draft/commit/delete routes |
| `GET/POST /admin/questions` | `GET/POST /admin/questions` |
| `POST /admin/questions/bulk-import` | same mobile bulk-import route |
| question template download | `GET /admin/questions/template` |
| question delete | `DELETE /admin/questions/:questionId` |
| `GET /admin/tests` | `GET /admin/tests` |
| test create/detail/edit | `POST /admin/tests`, `GET/PATCH /admin/tests/:testId` |
| `POST /admin/tests/upload-pdf` | `POST /admin/tests/upload-pdf` |
| question/answer-key PDF templates | matching `/admin/tests/template/*` downloads |
| test delete/publish | matching `DELETE` and `POST .../publish` routes |
| `GET /admin/results` | `GET /admin/results` with batch/test filters |
| `GET /admin/results/export` | same mobile Excel download route |
| web result detail/PDF links | shared authenticated result detail/PDF routes |
| `GET /admin/documents` | `GET /admin/documents` |
| `POST /admin/documents/:id/delete` | `DELETE /admin/documents/:documentId` |
