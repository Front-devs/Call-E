/**
 * Mirrors the working project into the pull-request directory.
 *
 * The hackathon requires the app to live at apps/typescript/call-e-code-commander/
 * in the awesome-phone-call-agents repository. Keeping a second copy by hand is
 * how a submission ends up shipping stale code, so this copies it instead.
 *
 * Usage: npm run sync
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'apps', 'typescript', 'call-e-code-commander');

/** Files and directories that belong in the submitted app directory. */
const INCLUDE = [
  'index.html', 'package.json', 'vite.config.js', 'vercel.json', '.gitignore', '.env.example', 'LICENSE',
  'api', 'src', 'test', 'scripts'
];

/**
 * Never copy these into the submission.
 *
 * .env is the one that matters. It holds a live API key and a real phone
 * number, and the target directory is the one that gets pushed to a public
 * repository, so it must never be copied there even by accident.
 */
const EXCLUDE = new Set(['node_modules', 'dist', '.git', 'apps', 'package-lock.json', '.env', '.env.local']);

function copyRecursive(from, to) {
  const stat = fs.statSync(from);

  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      if (EXCLUDE.has(entry)) continue;
      copyRecursive(path.join(from, entry), path.join(to, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// Clear everything except the README, which is authored in the target directory.
if (fs.existsSync(target)) {
  for (const entry of fs.readdirSync(target)) {
    if (entry === 'README.md') continue;
    fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
}

let copied = 0;
for (const entry of INCLUDE) {
  const from = path.join(root, entry);
  if (!fs.existsSync(from)) {
    console.warn(`skipped (missing): ${entry}`);
    continue;
  }
  copyRecursive(from, path.join(target, entry));
  copied++;
}

// The submitted app is standalone, so it must not carry the sync script itself.
const strayScript = path.join(target, 'scripts', 'syncAppDir.js');
if (fs.existsSync(strayScript)) fs.rmSync(strayScript);

// Nor a sync npm script that points at a directory that will not exist.
const pkgPath = path.join(target, 'package.json');
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  delete pkg.scripts.sync;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// Last line of defence. The submission directory is published, so anything
// that looks like a live key in it is a leak, whatever produced it.
const leaks = [];
function scanForKeys(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { scanForKeys(full); continue; }
    const text = fs.readFileSync(full, 'utf8');
    // A placeholder is fine. A long opaque suffix after the prefix is not.
    const match = text.match(/iams_live_[A-Za-z0-9_-]{20,}/);
    if (match) leaks.push(`${path.relative(root, full)}: ${match[0].slice(0, 18)}...`);
  }
}
scanForKeys(target);

if (leaks.length) {
  console.error('');
  console.error('Refusing to leave a live API key in the submission directory:');
  leaks.forEach((l) => console.error(`  ${l}`));
  console.error('');
  console.error('Replace it with a placeholder and run npm run sync again.');
  process.exit(1);
}

console.log(`Synced ${copied} entries into apps/typescript/call-e-code-commander/`);
console.log('README.md in that directory is authored separately and was left alone.');
console.log('No live API key found in the submission directory.');
