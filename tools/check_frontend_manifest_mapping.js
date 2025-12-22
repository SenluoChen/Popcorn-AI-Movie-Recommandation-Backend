#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const LOCAL_ROOT = path.resolve(__dirname, '..', 'Movie-data');
const MOVIES_NDJSON = path.join(LOCAL_ROOT, 'movies', 'movies.ndjson');
const MANIFEST = path.resolve(__dirname, '..', 'Popcorn', 'public', 'media_1000.json');

function readMovies() {
  if (!fs.existsSync(MOVIES_NDJSON)) throw new Error('movies.ndjson not found: ' + MOVIES_NDJSON);
  const lines = fs.readFileSync(MOVIES_NDJSON, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.map(l => JSON.parse(l));
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) throw new Error('manifest not found: ' + MANIFEST);
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

(function main(){
  try {
    const movies = readMovies();
    const manifest = readManifest();
    const byTmdb = manifest?.byTmdbId || {};
    const byImdb = manifest?.byImdbId || {};

    const withPoster = [];
    for (let i = 0; i < movies.length; i++) {
      const m = movies[i];
      const poster = m.posterUrl || m.poster_path || null;
      if (poster) withPoster.push({idx: i, movie: m});
    }

    const missing = [];
    for (const entry of withPoster) {
      const m = entry.movie;
      const tmdbId = String(Number(m.tmdbId || m.tmdb_id || m.id || 0));
      const imdbId = String(m.imdbId || m.imdbID || m.key || '').trim();
      let ok = false;
      if (tmdbId && tmdbId !== '0' && byTmdb[tmdbId]) ok = true;
      if (!ok && imdbId && byImdb[imdbId]) ok = true;
      if (!ok) missing.push({idx: entry.idx, tmdbId: m.tmdbId || null, imdbId: imdbId || null, title: m.title || m.originalTitle || null});
    }

    const result = {
      totalMovies: movies.length,
      withPoster: withPoster.length,
      manifestTotal: Object.keys(byTmdb).length,
      missingInManifest: missing.length,
      missingExamples: missing.slice(0, 20),
    };

    const outPath = path.join(path.dirname(MOVIES_NDJSON), '..', 'logs', 'frontend_manifest_mapping_check.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

    console.log('Check complete. Results written to', outPath);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
})();
