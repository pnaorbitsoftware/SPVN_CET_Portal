// models/Result.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Result = sequelize.define('Result', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  studentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  testId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'tests', key: 'id' },
  },
  score: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0,
  },
  totalMarks: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0,
  },
  correctAnswers: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  wrongAnswers: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  skippedAnswers: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  rank: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  percentile: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  timeTaken: {
    // in seconds
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  answers: {
    // JSON: { questionId: selectedOption }
    type: DataTypes.JSON,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('in_progress', 'submitted', 'auto_submitted'),
    defaultValue: 'in_progress',
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'results',
});

module.exports = Result;
