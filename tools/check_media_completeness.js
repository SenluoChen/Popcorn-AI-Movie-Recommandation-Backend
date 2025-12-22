#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const moviesPath = path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson');
const outReport = path.join(repoRoot, 'Movie-data', 'logs', 'media_completeness.json');

if (!fs.existsSync(moviesPath)) {
  console.error('movies.ndjson not found:', moviesPath);
  process.exit(2);
}

const lines = fs.readFileSync(moviesPath, 'utf8').split(/\r?\n/).filter(Boolean);
const total = lines.length;

let withPoster = 0;
let withTrailer = 0;
let withBoth = 0;
let badJson = 0;

const missingPosterExamples = [];
const missingTrailerExamples = [];

function isEmpty(v) { return v === undefined || v === null || String(v).trim() === ''; }

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let o;
  try { o = JSON.parse(line); } catch (e) { badJson++; continue; }
  const id = String(o.imdbId || o.key || '') || null;
  const title = String(o.title || '') || null;
  const tmdbId = o.tmdbId || o.tmdb_id || o.id || null;

  const hasPoster = !isEmpty(o.posterUrl) || !isEmpty(o.poster_path) || !isEmpty(o.poster);
  const hasTrailer = !isEmpty(o.trailerUrl) || Array.isArray(o.trailers) && o.trailers.some(t => t && !isEmpty(t.url));

  if (hasPoster) withPoster++;
  if (hasTrailer) withTrailer++;
  if (hasPoster && hasTrailer) withBoth++;

  if (!hasPoster && missingPosterExamples.length < 12) missingPosterExamples.push({ idx: i+1, imdbId: id, tmdbId, title });
  if (!hasTrailer && missingTrailerExamples.length < 12) missingTrailerExamples.push({ idx: i+1, imdbId: id, tmdbId, title });
}

const report = {
  generatedAt: new Date().toISOString(),
  total,
  badJson,
  withPoster,
  withTrailer,
  withBoth,
  missingPoster: total - withPoster,
  missingTrailer: total - withTrailer,
  missingPosterExamples,
  missingTrailerExamples,
};

fs.mkdirSync(path.dirname(outReport), { recursive: true });
fs.writeFileSync(outReport, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify(report, null, 2));
