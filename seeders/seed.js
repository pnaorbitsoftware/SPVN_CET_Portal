// seeders/seed.js
// Sample seed data for XYZ College CET Exam System

require('dotenv').config({ path: '../.env' });
const { sequelize } = require('../config/database');
const { User, Group, Question, Test, TestQuestion, GroupMember, TestGroup } = require('../models');
const bcrypt = require('bcryptjs');

async function seed() {
  try {
    await sequelize.sync({ force: true });
    console.log('✅ Database synced');

    // Admin
    const admin = await User.create({
      name: 'System Administrator',
      email: 'admin@xyzcollege.edu.in',
      password: 'Admin@XYZ2024',
      role: 'admin',
      isFirstLogin: false,
    });

    // Teachers
    const teacher1 = await User.create({ name: 'Dr. Priya Sharma', email: 'priya@xyzcollege.edu.in', password: 'Teacher@Priya2024', role: 'teacher', subject: 'Physics', isFirstLogin: false });
    const teacher2 = await User.create({ name: 'Prof. Rahul Verma', email: 'rahul@xyzcollege.edu.in', password: 'Teacher@Rahul2024', role: 'teacher', subject: 'Chemistry', isFirstLogin: false });

    // Groups
    const groupA = await Group.create({ name: 'PCM Batch-A 2024', description: 'Physics Chemistry Mathematics', academicYear: '2024-2025' });
    const groupB = await Group.create({ name: 'PCB Batch-B 2024', description: 'Physics Chemistry Biology',     academicYear: '2024-2025' });

    // Students
    const studentData = [
      { name: 'Arjun Mehta',   rollNo: '2024CE001', email: 'arjun@student.xyz', groupId: groupA.id },
      { name: 'Priya Patel',   rollNo: '2024CE002', email: 'priya@student.xyz', groupId: groupA.id },
      { name: 'Rohan Singh',   rollNo: '2024CE003', email: 'rohan@student.xyz', groupId: groupB.id },
      { name: 'Ananya Gupta',  rollNo: '2024CE004', email: 'ananya@student.xyz', groupId: groupA.id },
      { name: 'Kiran Kumar',   rollNo: '2024CE005', email: 'kiran@student.xyz', groupId: groupB.id },
    ];

    for (const sd of studentData) {
      const pw = `CET@${sd.rollNo.slice(-4)}`;
      const s = await User.create({ name: sd.name, email: sd.email, rollNo: sd.rollNo, password: pw, role: 'student', isFirstLogin: true });
      await GroupMember.create({ groupId: sd.groupId, userId: s.id, role: 'student' });
    }
    await GroupMember.create({ groupId: groupA.id, userId: teacher1.id, role: 'teacher' });
    await GroupMember.create({ groupId: groupB.id, userId: teacher2.id, role: 'teacher' });

    // Questions
    const qData = [
      { question: 'What is the SI unit of force?', optionA: 'Joule', optionB: 'Newton', optionC: 'Watt', optionD: 'Pascal', correctAnswer: 'B', subject: 'Physics', difficulty: 'Easy', marks: 1 },
      { question: 'Which law states that every action has an equal and opposite reaction?', optionA: 'First Law', optionB: 'Second Law', optionC: 'Third Law', optionD: 'Law of Gravitation', correctAnswer: 'C', subject: 'Physics', difficulty: 'Easy', marks: 1 },
      { question: 'What is the speed of light in vacuum?', optionA: '3×10⁸ m/s', optionB: '3×10⁶ m/s', optionC: '3×10⁷ m/s', optionD: '3×10⁹ m/s', correctAnswer: 'A', subject: 'Physics', difficulty: 'Medium', marks: 1 },
      { question: 'The atomic number of Carbon is?', optionA: '6', optionB: '12', optionC: '8', optionD: '4', correctAnswer: 'A', subject: 'Chemistry', difficulty: 'Easy', marks: 1 },
      { question: 'What is the chemical formula of water?', optionA: 'H₂O₂', optionB: 'HO', optionC: 'H₂O', optionD: 'H₃O', correctAnswer: 'C', subject: 'Chemistry', difficulty: 'Easy', marks: 1 },
      { question: 'pH of pure water is?', optionA: '0', optionB: '7', optionC: '14', optionD: '1', correctAnswer: 'B', subject: 'Chemistry', difficulty: 'Easy', marks: 1 },
      { question: 'The derivative of sin(x) is?', optionA: '-cos(x)', optionB: 'cos(x)', optionC: 'tan(x)', optionD: '-sin(x)', correctAnswer: 'B', subject: 'Mathematics', difficulty: 'Easy', marks: 1 },
      { question: 'What is ∫x dx?', optionA: 'x²', optionB: 'x + C', optionC: 'x²/2 + C', optionD: '2x', correctAnswer: 'C', subject: 'Mathematics', difficulty: 'Medium', marks: 1 },
      { question: 'Sum of angles in a triangle is?', optionA: '90°', optionB: '360°', optionC: '180°', optionD: '270°', correctAnswer: 'C', subject: 'Mathematics', difficulty: 'Easy', marks: 1 },
      { question: 'Ohm\'s law states V = ?', optionA: 'I/R', optionB: 'IR', optionC: 'I+R', optionD: 'I²R', correctAnswer: 'B', subject: 'Physics', difficulty: 'Easy', marks: 1 },
    ];

    const questions = [];
    for (const q of qData) {
      questions.push(await Question.create({ ...q, createdBy: teacher1.id }));
    }

    // Test
    const test = await Test.create({
      title: 'CET Mock Test 1 — PCM',
      description: 'First mock test covering Physics, Chemistry and Mathematics',
      duration: 30,
      totalMarks: 10,
      negativeMarking: 0.25,
      shuffleQuestions: true,
      status: 'published',
      instructions: 'Attempt all questions. Each correct answer carries 1 mark. Wrong answer deducts 0.25 marks.',
      createdBy: teacher1.id,
    });

    for (let i = 0; i < questions.length; i++) {
      await TestQuestion.create({ testId: test.id, questionId: questions[i].id, orderIndex: i });
    }
    await TestGroup.create({ testId: test.id, groupId: groupA.id });

    console.log('\n🎉 Seed complete!\n');
    console.log('─────────────────────────────────────────');
    console.log('  Admin:    admin@xyzcollege.edu.in / Admin@XYZ2024');
    console.log('  Teacher1: priya@xyzcollege.edu.in  / Teacher@Priya2024');
    console.log('  Teacher2: rahul@xyzcollege.edu.in  / Teacher@Rahul2024');
    console.log('  Student:  Roll=2024CE001            / CET@0001');
    console.log('─────────────────────────────────────────\n');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seed();
