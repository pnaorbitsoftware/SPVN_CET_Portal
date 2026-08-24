const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('administrator login preserves its secure form and student return path', () => {
  const view = fs.readFileSync(path.join(root, 'views', 'auth', 'admin-login.ejs'), 'utf8');
  assert.match(view, /action="\/auth\/admin" method="POST"/);
  assert.match(view, /name="email"/);
  assert.match(view, /name="password"/);
  assert.match(view, /href="\/auth\/login"/);
  assert.match(view, /admin-watermark-wrap[\s\S]+\/brand\/spvn-logo\.png/);
});

test('administrator login stylesheet centers the card and supports mobile layouts', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'admin-login.css'), 'utf8');
  assert.match(css, /place-items: center/);
  assert.match(css, /filter: blur\(/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
