// models/Result.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Result = sequelize.define('Result', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  studentId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  testId:    { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tests', key: 'id' } },
  score:     { type: DataTypes.FLOAT,   allowNull: false, defaultValue: 0 },
  totalMarks:{ type: DataTypes.FLOAT,   allowNull: false, defaultValue: 0 },
  correctAnswers: { type: DataTypes.INTEGER, defaultValue: 0 },
  wrongAnswers:   { type: DataTypes.INTEGER, defaultValue: 0 },
  skippedAnswers: { type: DataTypes.INTEGER, defaultValue: 0 },
  rank:       { type: DataTypes.INTEGER, allowNull: true },
  percentile: { type: DataTypes.FLOAT,   allowNull: true },
  timeTaken:  { type: DataTypes.INTEGER, allowNull: true }, // total seconds

  // Enhanced analytics fields
  answers: {
    // { questionId: { answer, timeSpent(sec), visitCount } }
    type: DataTypes.JSON, allowNull: true,
  },
  questionTimings: {
    // { questionId: secondsSpent }
    type: DataTypes.JSON, allowNull: true,
  },
  subjectScores: {
    // { Physics: { correct, wrong, skipped, marks }, ... }
    type: DataTypes.JSON, allowNull: true,
  },
  topicScores: {
    // { Kinematics: { correct, wrong }, ... }
    type: DataTypes.JSON, allowNull: true,
  },
  cheatingFlags: {
    // { tabSwitches: N, fullscreenExits: N, focusLosses: N }
    type: DataTypes.JSON, allowNull: true,
  },
  violationCount: { type: DataTypes.INTEGER, defaultValue: 0 },

  status: {
    type: DataTypes.ENUM('in_progress','submitted','auto_submitted','terminated'),
    defaultValue: 'in_progress',
  },
  questionOrder: { type: DataTypes.JSON, allowNull: true },
  markedForReview: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  startedAt:   { type: DataTypes.DATE, allowNull: true },
  submittedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'results' });

module.exports = Result;
