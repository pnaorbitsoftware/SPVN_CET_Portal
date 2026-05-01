# 🎓 XYZ College — CET Online Examination System

A full-stack CET-style exam portal built with **Node.js + Express + Sequelize + MySQL + EJS + Tailwind CSS**.

---

## 📁 Project Structure

```
cet-exam-system/
├── app.js                  # Entry point
├── .env                    # Environment config (college details)
├── config/
│   └── database.js         # Sequelize DB config
├── models/
│   ├── index.js            # Model registry + associations
│   ├── User.js             # Admin / Teacher / Student
│   ├── Group.js            # Batches/Groups
│   ├── Question.js         # MCQ Questions
│   ├── Test.js             # Exam definition
│   ├── TestQuestion.js     # Test ↔ Question junction
│   ├── Result.js           # Student exam results
│   ├── GroupMember.js      # User ↔ Group junction
│   ├── TestGroup.js        # Test ↔ Group junction
│   └── Notification.js     # In-app notifications
├── controllers/
│   ├── authController.js
│   ├── adminController.js
│   ├── teacherController.js
│   ├── studentController.js
│   └── examController.js
├── routes/
│   ├── auth.js
│   ├── admin.js
│   ├── teacher.js
│   ├── student.js
│   ├── exam.js
│   └── results.js
├── middleware/
│   └── auth.js             # isAuthenticated, requireRole, attachUser
├── views/
│   ├── partials/           # head, flash, sidebars
│   ├── auth/               # login, change-password
│   ├── admin/              # dashboard, students, teachers, groups, results
│   ├── teacher/            # dashboard, questions, tests, performance
│   ├── student/            # dashboard, tests, results, notifications
│   └── exam/               # instructions, question, result, leaderboard
├── utils/
│   └── passwordHelper.js
└── seeders/
    └── seed.js
```

---

## ⚙️ Setup Instructions

### 1. Prerequisites
- Node.js v18+
- MySQL 8.0+

### 2. Clone & Install
```bash
git clone <repo>
cd cet-exam-system
npm install
```

### 3. Configure Environment
Edit `.env` with your MySQL credentials:
```
DB_HOST=localhost
DB_NAME=xyz_cet_exam
DB_USER=root
DB_PASSWORD=your_password
```

### 4. Create Database
```sql
CREATE DATABASE xyz_cet_exam CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 5. Run Seed (creates tables + demo data)
```bash
cd seeders && node seed.js
```

### 6. Start Server
```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Open: **http://localhost:3000**

---

## 🔐 Default Login Credentials

| Role    | Username                     | Password            |
|---------|------------------------------|---------------------|
| Admin   | admin@xyzcollege.edu.in      | Admin@XYZ2024       |
| Teacher | priya@xyzcollege.edu.in      | Teacher@Priya2024   |
| Student | Roll No: **2024CE001**       | CET@0001            |
| Student | Roll No: **2024CE002**       | CET@0002            |

> **First login forces password change.**

---

## 🧑‍💼 Role Features

### Admin
- Dashboard with stats (students, teachers, tests, groups)
- Create Teacher accounts (auto-password: `Teacher@Name1234`)
- Create Student accounts (auto-password: `CET@XXXX`)
- Bulk import students via CSV/Excel
- Create groups/batches, assign members
- View all results

### Teacher
- Create MCQ tests (title, duration, negative marking, shuffle)
- Build question bank manually or via CSV import
- Assign tests to groups and publish
- View student performance & leaderboard

### Student
- View assigned tests with status
- CET-style exam interface:
  - Countdown timer (auto-submit on expiry)
  - Question palette (color-coded)
  - Mark for review
  - Real-time AJAX answer saving
  - Next/Previous navigation
- View result card with rank & percentile
- Download result as PDF

---

## 📋 CSV Import Format

### Students CSV
```
name,rollNo,email
Arjun Mehta,2024CE006,arjun@example.com
```

### Questions CSV
```
question,optionA,optionB,optionC,optionD,correctAnswer,subject,difficulty,marks
What is H₂O?,Water,Oxygen,Hydrogen,Salt,A,Chemistry,Easy,1
```

---

## 🛣️ Routes

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | /auth/login | Login |
| GET/POST | /auth/change-password | Change password |
| GET | /admin/dashboard | Admin dashboard |
| GET | /admin/students | Student management |
| GET | /teacher/tests/create | Create test |
| GET | /exam/:id/instructions | Exam instructions |
| GET | /exam/:id/question/:n | Exam question page |
| POST | /exam/:id/save-answer | AJAX save answer |
| POST | /exam/:id/submit | Submit exam |
| GET | /results/:id | Result card |
| GET | /results/:id/pdf | Download PDF |
| GET | /results/leaderboard/:testId | Leaderboard |

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express.js 4 |
| ORM | Sequelize 6 |
| Database | MySQL 8 |
| Templating | EJS |
| Styling | Tailwind CSS (CDN) |
| Auth | express-session + bcryptjs |
| PDF | pdfkit |
| File Import | xlsx (SheetJS) |
| File Upload | express-fileupload |

---

## 📝 Password Policy

- **Students**: `CET@` + last 4 digits of roll number (e.g. `CET@1001`)
- **Teachers**: `Teacher@` + FirstName + random 4 digits
- All passwords hashed with **bcrypt** (12 rounds)
- First login forces password change

---

*XYZ College of Engineering & Technology — Exam Cell*
