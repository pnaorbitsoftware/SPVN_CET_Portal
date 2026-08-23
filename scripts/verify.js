const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'mobile']);

function filesBelow(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignoredDirectories.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(fullPath, extension);
    return fullPath.endsWith(extension) ? [fullPath] : [];
  });
}

const javascriptFiles = filesBelow(root, '.js');
for (const file of javascriptFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

const viewDirectory = path.join(root, 'views');
const templateFiles = filesBelow(viewDirectory, '.ejs');
for (const file of templateFiles) {
  ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
}

require('../models');

console.log(`Verified ${javascriptFiles.length} JavaScript files and ${templateFiles.length} EJS templates.`);
