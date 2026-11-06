#!/usr/bin/env node
// Checks that relative targets of Markdown links in git-tracked *.md files exist.
// Untracked, non-ignored files are included so the check also works before the first commit.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const skip = /^(?:[a-z][a-z0-9+.-]*:|#)/i;
const problems = [];

for (const file of files) {
  const abs = join(root, file);
  if (!existsSync(abs)) continue; // staged for deletion
  let inFence = false;
  readFileSync(abs, 'utf8').split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const text = line.replace(/`[^`]*`/g, '');
    for (const match of text.matchAll(linkRe)) {
      let target = match[1];
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      if (skip.test(target)) continue;
      target = target.split('#')[0].split('?')[0];
      if (!target) continue;
      try {
        target = decodeURIComponent(target);
      } catch {
        // keep the raw target
      }
      const resolved = target.startsWith('/') ? join(root, target) : resolve(dirname(abs), target);
      if (!existsSync(resolved)) problems.push(`${file}:${index + 1} → ${match[1]}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`Broken Markdown links (${problems.length}):`);
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`docs-check: ${files.length} Markdown files, all relative links resolve.`);
