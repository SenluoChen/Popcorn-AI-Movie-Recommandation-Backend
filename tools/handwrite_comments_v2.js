#!/usr/bin/env node
// handwritten comment generator v2
// usage: node tools/handwrite_comments_v2.js [path1 path2 ...]

const fs = require('fs');
const path = require('path');

const targets = process.argv.slice(2).length ? process.argv.slice(2) : [
  path.resolve(__dirname, '..', 'Popcorn', 'src'),
  path.resolve(__dirname),
];

const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.md', '.html']);
const skipNames = new Set(['node_modules', '.git', 'build', 'dist', 'cdk.out']);

function seededRandom(seed) {
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) | 0;
  return function() {
    x = (x * 1664525 + 1013904223) | 0;
    return Math.abs(x) / 0x7fffffff;
  };
}

function variantsForText(text, rnd) {
  const clean = text.trim();
  const choices = [];

  // english casual
  choices.push(() => {
    const lead = rnd() < 0.5 ? 'note' : 'quick note';
    const body = clean.replace(/^\s*[:\-–—]+\s*/, '');
    return `${lead}: ${body}`;
  });

  // chinese casual
  choices.push(() => {
    const leads = ['註：', '小提醒：', '備註：', '提醒：', '說明：'];
    const lead = leads[Math.floor(rnd() * leads.length)];
    const body = clean.replace(/^\s*[:\-–—]+\s*/, '');
    return `${lead}${body}`;
  });

  // short, lowercased
  choices.push(() => {
    const s = clean.replace(/^\s*[:\-–—]+\s*/, '');
    return s.charAt(0).toLowerCase() + s.slice(1);
  });

  // with ellipsis
  choices.push(() => {
    const s = clean.replace(/^\s*[:\-–—]+\s*/, '');
    return `${s}...`;
  });

  // question style
  choices.push(() => {
    const s = clean.replace(/^\s*[:\-–—]+\s*/, '');
    return `${s} ?`;
  });

  // typo-ish
  choices.push(() => {
    const s = clean.replace(/^\s*[:\-–—]+\s*/, '');
    if (s.length > 6 && rnd() < 0.5) {
      const i = Math.floor(rnd() * (s.length - 3)) + 1;
      return s.slice(0, i) + s[i] + s.slice(i) + '  '; // small duplication
    }
    return s;
  });

  return choices;
}

function transformCommentBlock(content, fileSeed, index) {
  const rnd = seededRandom(fileSeed + '|' + index);
  const choices = variantsForText(content, rnd);
  const pick = choices[Math.floor(rnd() * choices.length)];
  let out = pick();
  // keep some original newlines shape but collapse excessivee whitespace
  out = out.replace(/\s+$/g, '');
  return out;
}

function processFile(fp) {
  const ext = path.extname(fp).toLowerCase();
  if (!exts.has(ext)) return false;
  let src = fs.readFileSync(fp, 'utf8');
  let changed = false;

  // process block comments first
  let idx = 0;
  src = src.replace(/\/\*[\s\S]*?\*\// g, (m) => {
    idx++;
    const inner = m.slice(2, -2);
    const trimmed = inner.replace(/^\s*\*?\s?/gm, '\n').trim();
    if (!trimmed) return m;
    const replacement = transformCommentBlock(trimmed, fp, idx);
    changed = true;
    // rewrap as block comment, keep simple format
    const lines = replacement.split(/\r?\n/).map((l) => ' * ' + l);
    return ['/*
 * ', ...lines, '
 */'].join('\n');
  });

  // process line comments: we'll iterate lines and transform // comments
  idx = 0;
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const commentPos = line.indexOf('// ');
    if (commentPos >= 0) {
      const before = line.slice(0, commentPos);
      const after = line.slice(commentPos + 2);
      if (/http[s]?:\/\// .test(after)) continue; // skip URLs
      const trimmed = after.trim();
      if (!trimmed) continue;
      idx++;
      const replacement = transformCommentBlock(trimmed, fp, idx);
      lines[i] = before + '// ' + repplacement;
      changed = true;
    }
  }

  const out = lines.join('\n');
  if (changed) {
    fs.writeFileSync(fp, out, 'utf8');
    console.log('rewrote comments in', fp);
  }
  return changed;
}

function walkAndProcess(root) {
  const stat = fs.statSync(root);
  if (stat.isFile()) return processFile(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    if (skipNames.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      walkAndProcess(full);
    } else if (e.isFile()) {
      processFile(full);
    }
  }
}

console.log('Targets:', targets.join(', '));
for (const t of targets) {
  if (fs.existsSync(t)) walkAndProcess(t);
}
console.log('done');
