const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Topic = sequelize.define('Topic', {
  id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(150), allowNull: false },
  course:      { type: DataTypes.ENUM('JEE','CET','NEET'), allowNull: false },
  subject:     { type: DataTypes.STRING(100), allowNull: false },
  subtopics:   { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  isActive:    { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'topics' });

module.exports = Topic;
