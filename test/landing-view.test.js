const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('landing page exposes accessible portal paths and verified contact placeholders', () => {
  const view = fs.readFileSync(path.join(root, 'views', 'landing.ejs'), 'utf8');
  assert.match(view, /href="\/auth\/login"/);
  assert.match(view, /href="\/auth\/admin"/);
  assert.match(view, /officialContact\.phone/);
  assert.match(view, /officialContact\.email/);
  assert.match(view, /alt="The entrance and campus building of Shardabai Pawar Vidya Niketan/);
});

test('landing animation settles the logo into the navbar and respects reduced motion', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'landing.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'landing.css'), 'utf8');
  assert.match(script, /getElementById\('travelLogo'\)/);
  assert.match(script, /getElementById\('brandTarget'\)/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
