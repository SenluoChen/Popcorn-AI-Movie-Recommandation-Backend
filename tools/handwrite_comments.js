#!/usr/bin/env node
// 備註：Script: handwrite_comments.js
// 小提醒：Purpose: rewrite comments in source files to remove hyphen characters and
// 註：make annotation-like tags less formal without changing code.
// 註：Usage: node tools/handwrite_comments.js

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skipDirs = new Set(['node_modules', '.git', 'build', 'dist', 'Movie-data', 'public', 'Popcorn/build']);
const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.md']);

function shouldSkip(dir) {
  const name = path.basename(dir);
  return skipDirs.has(name);
}

function transformCommentText(txt) {
  // 小提醒：Replace plain hyphen '—' with an em dash '—' or a bullet where appropriate.
  // 備註：Also make common JSDoc tags less formal by removing @ prefix.
  let s = txt;
  // 備註：Replace sequences like ' — ' with ' — '
  s = s.replace(/\s-\s/g, ' — ');
  // 提醒：Replace leading '— ' in lines with a bullet •
  s = s.replace(/^\s*-\s/gm, '  • ');
  // 說明：Remove remaining standalone hyphen characters inside comment text
  s = s.replace(/([^\w])-(?=[^\w])/g, '$1—');
  // Convert param, returns, example to informal labels ?
  s = s.replace(/@param/g, 'param');
  s = s.replace(/@returns/g, 'returns');
  s = s.replace(/@return/g, 'returns');
  s = s.replace(/@example/g, 'example');
  s = s.replace(/@deprecated/g, 'deprecated');
  // Tidy up repeated spaces ?
  s = s.replace(/\t/g, '  ');
  s = s.replace(/ {3,}/g, '  ');
  return s;
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Process block comments /* ?
 * 備註：...
 */
  content = content.replace(/\/\*[\s\S]*?\*\// g, (match) => { ?
    return transformCommentText(match);
  });

  // Process line comments //... ?
  content = content.replace(/(^|[^:\\])\/\/.*/gm, (match, p1) => {
    // match includes the prefix char; preserve it ?
    const prefix = p1 || '';
    const comment = match.slice(prefix.length);
    const transformed = transformCommentText(comment);
    return prefix + transformed;
  });

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated', filePath);
    return true;
  }
  return false;
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (shouldSkip(full)) continue;
      walk(full);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!exts.has(ext)) continue;
      try {
        processFile(full);
      } catch (err) {
        console.error('Error processing', full, err && err.message);
      }
    }
  }
}

console.log('Starting comment transformation from', root);
walk(root);
console.log('Done');
