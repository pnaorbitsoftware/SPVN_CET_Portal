# SPVN CET Native App Feature Parity

The native application mirrors every interactive web portal area through protected mobile APIs. It does not use a WebView.

## Student

- [x] Student login and secure session restore
- [x] First-login and regular password change
- [x] Dashboard, test categories, results and notifications
- [x] Test instructions, CET section summary, start and resume
- [x] Native question palette, timer, section locking and review marks
- [x] Answer persistence on navigation and exam exit
- [x] App-background violation tracking and threshold auto-submit
- [x] Manual and timer auto-submit with rank calculation
- [x] Document upload, list and viewing
- [x] Result detail, subject breakdown and question review
- [x] Leaderboard and result PDF download/share
- [x] Profile and logout

## Admin

- [x] Admin login, dashboard counts and recent activity
- [x] Student search, profile, create, deactivate and credentials
- [x] Bulk student import, template and batch assignment
- [x] Batch create/edit/delete and member add/remove/move
- [x] New student and bulk import inside a batch
- [x] Batch credentials PDF download/share
- [x] Syllabus filters and topic/subtopic create/edit/delete
- [x] AI syllabus PDF import
- [x] Question list/filter/create/edit/delete
- [x] Question Excel/CSV bulk import and template
- [x] Smart scanner camera/file scan, editable review, commit and discard
- [x] Test create/edit/delete, hierarchy filters and visible-select toggle
- [x] PDF test upload, solution upload and both PDF templates
- [x] Batch assignment, anti-cheat settings and publishing notifications
- [x] Result filters, detail, result PDF and Excel export
- [x] Student document review/open/delete

## Quality and release readiness

- [x] Android icon, splash, package ID and SPVN branding
- [x] SecureStore token persistence and logout cleanup
- [x] API error states, validation, loading states and pull-to-refresh
- [x] TypeScript check
- [x] Expo Doctor (21/21)
- [x] Android Metro production bundle smoke test
- [x] Live MongoDB/API admin route and download smoke tests
- [ ] Deploy the updated backend before testing the production APK URL
- [ ] Signed Android App Bundle / Play Store release
