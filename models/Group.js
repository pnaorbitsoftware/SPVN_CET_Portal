// models/Group.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Group = sequelize.define('Group', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  academicYear: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: process.env.ACADEMIC_YEAR || '2024-2025',
  },
  course: { type: DataTypes.ENUM('JEE','CET','NEET'), allowNull: true },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'groups',
});

module.exports = Group;
