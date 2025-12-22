#!/usr/bin/env node
'use strict';

// quick note: Merge a backup NDJSON (1000) into the current movies.ndjson (likely smaller).
// note: Policy: prefer fields from the current primary file; supplement missing movies/fields from backup.
// note: Usage:
// note: node tools/merge_movies_from_backup.js [—-backup <path>] [—-in <path>] [—-out <path>] [—-no-backup]

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    backupPath: path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson.bak.1766316803418'),
    inPath: path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson'),
    outPath: '',
    keepBackup: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--backup') out.backupPath = path.resolve(String(argv[++i]));
    else if (a === '--in') out.inPath = path.resolve(String(argv[++i]));
    else if (a === '--out') out.outPath = path.resolve(String(argv[++i]));
    else if (a === '--no-backup') out.keepBackup = false;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tools/merge_movies_from_backup.js [--backup <path>] [--in <path>] [--out <path>] [--no-backup]');
      process.exit(0);
    }
  }
  if (!out.outPath) out.outPath = out.inPath; // note: overwrite by default
  return out;
}

function safeParseLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((l, idx) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`Bad json in ${filePath} at line ${idx+1}: ${e.message}`); }
  });
}

function computeId(m) {
  const imdb = String(m?.imdbId || m?.imdbID || m?.key || '').trim();
  if (/^tt\d+$/i.test(imdb)) return `imdb:${imdb.toLowerCase()}`;
  const tmdb = Number(m?.tmdbId || m?.tmdb_id || m?.id);
  if (Number.isFinite(tmdb) && tmdb > 0) return `tmdb:${tmdb}`;
  const title = String(m?.title || '').trim().toLowerCase();
  const year = String(m?.year || '').slice(0,4) || '';
  if (title) return `title:${title}|${year}`;
  return `line:${Math.random().toString(36).slice(2,8)}`;
}

function mergeRecords(primaryList, backupList) {
  const primaryMap = new Map();
  for (const p of primaryList) primaryMap.set(computeId(p), p);
  const backupMap = new Map();
  for (const b of backupList) backupMap.set(computeId(b), b);

  const keys = new Set([...primaryMap.keys(), ...backupMap.keys()]);
  const merged = [];
  for (const k of keys) {
    const p = primaryMap.get(k);
    const b = backupMap.get(k);
    if (p && b) {
      // note: Start with backup, then overlay primary so primary fields win
      merged.push(Object.assign({}, b, p));
    } else if (p) merged.push(p);
    else if (b) merged.push(b);
  }
  return merged;
}

(function main(){
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.backupPath)) throw new Error('Backup not found: ' + args.backupPath);
  if (!fs.existsSync(args.inPath)) throw new Error('Primary movies.ndjson not found: ' + args.inPath);

  console.log('Loading primary:', args.inPath);
  console.log('Loading backup:', args.backupPath);

  const primary = safeParseLines(args.inPath);
  const backup = safeParseLines(args.backupPath);

  console.log('Primary count:', primary.length);
  console.log('Backup count:', backup.length);

  const merged = mergeRecords(primary, backup);
  console.log('Merged count:', merged.length);

  // quick note: Backup current primary file before overwrite
  if (args.outPath === args.inPath && args.keepBackup) {
    const bakPath = args.inPath + '.premerge.' + Date.now();
    fs.copyFileSync(args.inPath, bakPath);
    console.log('Existing primary backed up to', bakPath);
  }

  // quick note: Write merged to outPath
  fs.writeFileSync(args.outPath, merged.map(x => JSON.stringify(x)).join('\n') + (merged.length ? '\n' : ''), 'utf8');
  console.log('Wrote merged file to', args.outPath);

  // quick note: Summary
  const summary = {
    primaryCount: primary.length,
    backupCount: backup.length,
    mergedCount: merged.length,
    outPath: args.outPath,
  };
  const reportPath = path.join(repoRoot, 'Movie-data', 'logs', 'merge_movies_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('Wrote report to', reportPath);
})();
