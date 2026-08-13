const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['api', 'lib', 'scripts'];
const files = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && target.endsWith('.js')) files.push(target);
  });
}

roots.forEach(walk);
files.forEach((file) => execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' }));
execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build'], { stdio: 'inherit' });
console.log(`Checked ${files.length} server/script files and the Vite production build.`);
