// models/index.js
// Central model registry with all associations

const User = require('./User');
const Group = require('./Group');
const Question = require('./Question');
const Test = require('./Test');
const TestQuestion = require('./TestQuestion');
const Result = require('./Result');
const GroupMember = require('./GroupMember');
const TestGroup = require('./TestGroup');
const Notification = require('./Notification');

// ─── ASSOCIATIONS ────────────────────────────────────────────────────────────

// User ↔ Group (many-to-many via GroupMember)
User.belongsToMany(Group, { through: GroupMember, foreignKey: 'userId', as: 'groups' });
Group.belongsToMany(User, { through: GroupMember, foreignKey: 'groupId', as: 'members' });
GroupMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
GroupMember.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });

// Test ↔ User (Teacher creates Test)
Test.belongsTo(User, { foreignKey: 'createdBy', as: 'teacher' });
User.hasMany(Test, { foreignKey: 'createdBy', as: 'tests' });

// Test ↔ Question (many-to-many via TestQuestion)
Test.belongsToMany(Question, { through: TestQuestion, foreignKey: 'testId', as: 'questions' });
Question.belongsToMany(Test, { through: TestQuestion, foreignKey: 'questionId', as: 'tests' });
TestQuestion.belongsTo(Test, { foreignKey: 'testId', as: 'test' });
TestQuestion.belongsTo(Question, { foreignKey: 'questionId', as: 'question' });

// Test ↔ Group (many-to-many via TestGroup)
Test.belongsToMany(Group, { through: TestGroup, foreignKey: 'testId', as: 'groups' });
Group.belongsToMany(Test, { through: TestGroup, foreignKey: 'groupId', as: 'tests' });

// Result
Result.belongsTo(User, { foreignKey: 'studentId', as: 'student' });
Result.belongsTo(Test, { foreignKey: 'testId', as: 'test' });
User.hasMany(Result, { foreignKey: 'studentId', as: 'results' });
Test.hasMany(Result, { foreignKey: 'testId', as: 'results' });

// Question creator
Question.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// Notifications
Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });

module.exports = {
  User,
  Group,
  Question,
  Test,
  TestQuestion,
  Result,
  GroupMember,
  TestGroup,
  Notification,
};
