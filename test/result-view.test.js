const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('released result view keeps actions valid with a populated test document', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'exam', 'result.ejs'), 'utf8');
  assert.match(template, /results\/leaderboard\/<%= result\.testId\?\._id \|\| result\.testId %>/);
  assert.doesNotMatch(template, /z'\/><\/svg>/);
});
