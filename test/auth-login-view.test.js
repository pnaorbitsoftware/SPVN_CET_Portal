const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('student login keeps the authentication and PWA contract while using SPVN branding', () => {
  const view = fs.readFileSync(path.join(root, 'views', 'auth', 'login.ejs'), 'utf8');
  assert.match(view, /action="\/auth\/login" method="POST"/);
  assert.match(view, /name="identifier"/);
  assert.match(view, /name="password"/);
  assert.match(view, /id="pwa-install-trigger"/);
  assert.match(view, /href="\/auth\/admin"/);
  assert.match(view, /story-watermark[^>]+\/brand\/spvn-logo\.png/);
});

test('student login stylesheet supports desktop, mobile and reduced motion', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'auth-login.css'), 'utf8');
  assert.match(css, /--auth-forest-900/);
  assert.match(css, /filter: blur\(/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
