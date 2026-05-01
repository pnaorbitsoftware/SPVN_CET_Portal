// models/TestGroup.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TestGroup = sequelize.define('TestGroup', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  testId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'tests', key: 'id' },
  },
  groupId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'groups', key: 'id' },
  },
}, {
  tableName: 'test_groups',
});

module.exports = TestGroup;
