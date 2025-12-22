#!/usr/bin/env node
'use strict';

// Publish a local TMDb media manifest to the frontend public folder.
// Converts `items[]` into an efficient `byTmdbId` map.
// Usage:
//  node tools/publish_media_manifest.js <src.json> <dst.json>

const fs = require('fs');
const path = require('path');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const src = process.argv[2];
const dst = process.argv[3];
if (!src || !dst) {
  die('Usage: node tools/publish_media_manifest.js <src.json> <dst.json>');
}

const srcPath = path.resolve(src);
const dstPath = path.resolve(dst);
if (!fs.existsSync(srcPath)) die('Source not found: ' + srcPath);

const raw = fs.readFileSync(srcPath, 'utf8');
const j = JSON.parse(raw);
const items = Array.isArray(j?.items) ? j.items : [];

const byTmdbId = {};
const byImdbId = {};
for (const it of items) {
  const tmdbId = Number(it?.tmdbId);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
  const entry = {
    tmdbId,
    imdbId: it?.imdbId || null,
    title: it?.title || null,
    year: it?.year || null,
    posterUrl: it?.posterUrl || null,
    trailers: Array.isArray(it?.trailers)
      ? it.trailers
          .filter((t) => t && t.url)
          .map((t) => ({
            name: t.name || null,
            site: t.site || null,
            type: t.type || null,
            key: t.key || null,
            url: t.url,
          }))
      : [],
  };

  byTmdbId[String(tmdbId)] = entry;

  const imdbId = String(it?.imdbId || '').trim();
  if (/^tt\d+$/i.test(imdbId)) {
    // Prefer first occurrence; duplicates should be rare.
    if (!byImdbId[imdbId]) byImdbId[imdbId] = entry;
  }
}

const out = {
  generatedAt: j?.generatedAt || new Date().toISOString(),
  byTmdbId,
  byImdbId,
  stats: {
    total: Object.keys(byTmdbId).length,
    imdbTotal: Object.keys(byImdbId).length,
  },
};

fs.mkdirSync(path.dirname(dstPath), { recursive: true });
fs.writeFileSync(dstPath, JSON.stringify(out, null, 2), 'utf8');

console.log('Wrote', dstPath, 'items=', out.stats.total);
