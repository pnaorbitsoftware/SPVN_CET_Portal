const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StudentDocument = sequelize.define('StudentDocument', {
  id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  studentId:   { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  fileName:    { type: DataTypes.STRING(255), allowNull: false },
  originalName:{ type: DataTypes.STRING(255), allowNull: false },
  fileType:    { type: DataTypes.STRING(100), allowNull: true },
  fileSize:    { type: DataTypes.INTEGER, allowNull: true },
  filePath:    { type: DataTypes.STRING(500), allowNull: false },
  description: { type: DataTypes.STRING(255), allowNull: true },
}, { tableName: 'student_documents' });

module.exports = StudentDocument;
