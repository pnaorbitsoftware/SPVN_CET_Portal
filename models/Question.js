// models/Question.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Question = sequelize.define('Question', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  question: { type: DataTypes.TEXT, allowNull: false },
  questionImage: { type: DataTypes.STRING(500), allowNull: true }, // image.io / imgbb URL
  optionA: { type: DataTypes.TEXT, allowNull: false },
  optionB: { type: DataTypes.TEXT, allowNull: false },
  optionC: { type: DataTypes.TEXT, allowNull: false },
  optionD: { type: DataTypes.TEXT, allowNull: false },
  optionAImage: { type: DataTypes.STRING(500), allowNull: true },
  optionBImage: { type: DataTypes.STRING(500), allowNull: true },
  optionCImage: { type: DataTypes.STRING(500), allowNull: true },
  optionDImage: { type: DataTypes.STRING(500), allowNull: true },
  correctAnswer: { type: DataTypes.ENUM('A','B','C','D'), allowNull: false },
  subject: {
    type: DataTypes.ENUM('Physics','Chemistry','Mathematics','Biology','English','General Knowledge'),
    allowNull: false,
  },
  difficulty: { type: DataTypes.ENUM('Easy','Medium','Hard'), allowNull: false, defaultValue: 'Medium' },
  marks: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1.0 },
  explanation: { type: DataTypes.TEXT, allowNull: true },
  explanationImage: { type: DataTypes.STRING(500), allowNull: true },
  topic: { type: DataTypes.STRING(100), allowNull: true }, // sub-topic for weak topic analysis
  createdBy: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'questions' });

module.exports = Question;
