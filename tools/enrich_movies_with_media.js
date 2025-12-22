#!/usr/bin/env node
'use strict';

// Enrich Movie-data/movies/movies.ndjson with poster/trailer fields from a TMDb media manifest. ?
//
// Primary goal: fix missing cover/trailer by syncing from Movie-data/movies/media_manifest_1000.json. ?
//
// Usage: ?
// node tools/enrich_movies_with_media.js ?
// node tools/enrich_movies_with_media.js —-in Movie-data/movies/movies.ndjson —-media Movie-data/movies/media_manifest_1000.json ?
// node tools/enrich_movies_with_media.js —-no-inplace —-out Movie-data/movies/movies.enriched.ndjson ?
//
// Notes: ?
// Writes a backup by default when editing in-place. ?
// Adds/updates: ?
// 提醒：poster_path (derived from posterUrl when possible)
// 說明：posterUrl (full URL)
// 說明：trailerUrl (best candidate: first trailer url)

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const defaults = {
    inPath: path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson'),
    mediaPath: path.join(repoRoot, 'Movie-data', 'movies', 'media_manifest_1000.json'),
    inplace: true,
    outPath: '',
    backup: true,
    reportPath: path.join(repoRoot, 'Movie-data', 'logs', 'enrich_media_report.json'),
  };

  const out = { ...defaults };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') out.inPath = path.resolve(String(argv[++i]));
    else if (a === '--media') out.mediaPath = path.resolve(String(argv[++i]));
    else if (a === '--no-inplace') out.inplace = false;
    else if (a === '--out') out.outPath = path.resolve(String(argv[++i]));
    else if (a === '--no-backup') out.backup = false;
    else if (a === '--report') out.reportPath = path.resolve(String(argv[++i]));
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tools/enrich_movies_with_media.js [--in <movies.ndjson>] [--media <media_manifest_1000.json>] [--no-inplace --out <out.ndjson>] [--no-backup] [--report <report.json>]');
      process.exit(0);
    }
  }

  if (!out.inplace) {
    if (!out.outPath) {
      out.outPath = path.join(path.dirname(out.inPath), 'movies.enriched.ndjson');
    }
  }

  return out;
}

function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function safeJsonParse(line, idx) {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (e) {
    return { ok: false, error: `Bad JSON at line ${idx + 1}: ${String(e?.message || e)}` };
  }
}

function pickTmdbId(movie) {
  const id = Number(movie?.tmdbId ?? movie?.tmdb_id ?? movie?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizePosterUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw;
}

function posterPathFromPosterUrl(url) {
  const raw = normalizePosterUrl(url);
  if (!raw) return '';

  // Typical: https://image.tmdb.org/t/p/original/<path>
  const m = raw.match(/image\.tmdb\.org\/t\/p\/(?:original|w\d+)\/(.+)$/i);
  if (m && m[1]) return '/' + m[1].replace(/^\/+/, '');

  // 提醒：If it's already a path-like string, keep it.
  if (raw.startsWith('/')) return raw;

  return '';
}

function bestTrailerUrl(trailers) {
  if (!Array.isArray(trailers) || trailers.length === 0) return '';
  for (const t of trailers) {
    const u = String(t?.url || '').trim();
    if (u) return u;
  }
  return '';
}

function loadMediaIndex(mediaPath) {
  if (!fs.existsSync(mediaPath)) throw new Error('Media manifest not found: ' + mediaPath);
  const j = JSON.parse(fs.readFileSync(mediaPath, 'utf8'));
  const items = Array.isArray(j?.items) ? j.items : [];
  const byTmdbId = new Map();
  for (const it of items) {
    const tmdbId = Number(it?.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    byTmdbId.set(tmdbId, it);
  }
  return { byTmdbId, meta: { generatedAt: j?.generatedAt || null, source: j?.source || null } };
}

function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.inPath)) throw new Error('NDJSON not found: ' + args.inPath);

  const text = fs.readFileSync(args.inPath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);

  const { byTmdbId, meta } = loadMediaIndex(args.mediaPath);

  const outLines = [];
  const report = {
    generatedAt: new Date().toISOString(),
    input: { moviesNdjson: args.inPath, mediaManifest: args.mediaPath, mediaGeneratedAt: meta.generatedAt, mediaSource: meta.source },
    totals: { movies: lines.length, badJson: 0 },
    counts: {
      missingTmdbId: 0,
      missingMediaEntry: 0,
      updatedPosterPath: 0,
      updatedPosterUrl: 0,
      updatedTrailerUrl: 0,
      stillMissingPoster: 0,
      stillMissingTrailer: 0,
    },
    examples: {
      missingTmdbId: [],
      missingMediaEntry: [],
      stillMissingPoster: [],
      stillMissingTrailer: [],
    },
  };

  const pushExample = (arr, item) => {
    if (arr.length >= 12) return;
    arr.push(item);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = safeJsonParse(line, i);
    if (!parsed.ok) {
      report.totals.badJson += 1;
      continue;
    }

    const movie = parsed.value;
    const tmdbId = pickTmdbId(movie);
    if (!tmdbId) {
      report.counts.missingTmdbId += 1;
      pushExample(report.examples.missingTmdbId, { imdbId: movie?.imdbId || movie?.key || null, title: movie?.title || null, year: movie?.year || null });
      outLines.push(JSON.stringify(movie));
      continue;
    }

    const media = byTmdbId.get(tmdbId) || null;
    if (!media) {
      report.counts.missingMediaEntry += 1;
      pushExample(report.examples.missingMediaEntry, { tmdbId, imdbId: movie?.imdbId || movie?.key || null, title: movie?.title || null, year: movie?.year || null });
      outLines.push(JSON.stringify(movie));
      continue;
    }

    const next = { ...movie };

    const posterUrl = normalizePosterUrl(media?.posterUrl);
    const posterPath = posterPathFromPosterUrl(posterUrl);
    const trailerUrl = bestTrailerUrl(media?.trailers);

    if (isEmpty(next.poster_path) && posterPath) {
      next.poster_path = posterPath;
      report.counts.updatedPosterPath += 1;
    }

    if (isEmpty(next.posterUrl) && posterUrl) {
      next.posterUrl = posterUrl;
      report.counts.updatedPosterUrl += 1;
    }

    if (isEmpty(next.trailerUrl) && trailerUrl) {
      next.trailerUrl = trailerUrl;
      report.counts.updatedTrailerUrl += 1;
    }

    // 備註：Post-checks for remaining gaps (for this movie)
    if (isEmpty(next.poster_path) && isEmpty(next.posterUrl)) {
      report.counts.stillMissingPoster += 1;
      pushExample(report.examples.stillMissingPoster, { tmdbId, imdbId: next?.imdbId || next?.key || null, title: next?.title || null, year: next?.year || null });
    }
    if (isEmpty(next.trailerUrl)) {
      report.counts.stillMissingTrailer += 1;
      pushExample(report.examples.stillMissingTrailer, { tmdbId, imdbId: next?.imdbId || next?.key || null, title: next?.title || null, year: next?.year || null });
    }

    outLines.push(JSON.stringify(next));
  }

  // 小提醒：Write output
  if (args.inplace) {
    if (args.backup) {
      const backupPath = args.inPath + `.bak.${Date.now()}`;
      fs.writeFileSync(backupPath, text, 'utf8');
      report.backup = backupPath;
    }
    fs.writeFileSync(args.inPath, outLines.join('\n') + (outLines.length ? '\n' : ''), 'utf8');
    report.output = args.inPath;
  } else {
    fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
    fs.writeFileSync(args.outPath, outLines.join('\n') + (outLines.length ? '\n' : ''), 'utf8');
    report.output = args.outPath;
  }

  // 註：Write report
  fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
  fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    output: report.output,
    report: args.reportPath,
    totals: report.totals,
    counts: report.counts,
  }, null, 2));
}

main();
