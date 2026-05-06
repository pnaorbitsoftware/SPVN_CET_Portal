// models/Test.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Test = sequelize.define('Test', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  duration: {
    // in minutes
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 180,
  },
  totalMarks: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0,
  },
  negativeMarking: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0.25,
  },
  passingMarks: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  shuffleQuestions: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  shuffleOptions: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  status: {
    type: DataTypes.ENUM('draft', 'published', 'active', 'closed'),
    defaultValue: 'draft',
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  instructions: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  course:      { type: DataTypes.ENUM('JEE','CET','NEET'), allowNull: true },
  subject:     { type: DataTypes.STRING(100), allowNull: true },
  topic:       { type: DataTypes.STRING(150), allowNull: true },
  subtopic:    { type: DataTypes.STRING(150), allowNull: true },
  questionPdfPath:  { type: DataTypes.STRING(500), allowNull: true },
  solutionPdfPath:  { type: DataTypes.STRING(500), allowNull: true },
  marksPerQuestion: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 1 },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'tests',
});

module.exports = Test;

// Patch: add course/subject/topic/subtopic/PDF fields via alter (handled in sync)
