#!/usr/bin/env node
'use strict';

// Build a media manifest (poster + trailer candidates) for local movies.ndjson.
// Usage:
//   node tools/fetch_media_for_local_movies.js --limit 1000
// Env:
//   TMDB_API_KEY (or TMDB_KEY or TMDB)
//   LOCAL_DATA_PATH (optional; defaults to ../../../Movie-data)

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Load .env from movie-api-test (if present)
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch {
  // ignore
}

const LOCAL_ROOT = path.resolve(process.env.LOCAL_DATA_PATH || path.join(__dirname, '..', '..', '..', 'Movie-data'));
const MOVIES_NDJSON = path.join(LOCAL_ROOT, 'movies', 'movies.ndjson');
const OUT_DEFAULT = path.join(LOCAL_ROOT, 'movies', 'media_manifest_1000.json');

const TMDB_KEY = process.env.TMDB_API_KEY || process.env.TMDB_KEY || process.env.TMDB;
if (!TMDB_KEY) {
  console.error('Missing TMDB_API_KEY in environment. Set TMDB_API_KEY and retry.');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { limit: 1000, outPath: OUT_DEFAULT, concurrency: 4, language: 'en-US', resume: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--out') out.outPath = String(argv[++i]);
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i]));
    else if (a === '--language') out.language = String(argv[++i]);
    else if (a === '--no-resume') out.resume = false;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tools/fetch_media_for_local_movies.js --limit 1000 --concurrency 4 --out <path>');
      process.exit(0);
    }
  }
  return out;
}

function readMovies(limit) {
  if (!fs.existsSync(MOVIES_NDJSON)) throw new Error('movies.ndjson not found: ' + MOVIES_NDJSON);
  const lines = fs.readFileSync(MOVIES_NDJSON, 'utf8').split(/\r?\n/).filter(Boolean);
  const slice = Number.isFinite(limit) && limit > 0 ? lines.slice(0, limit) : lines;
  return slice.map((l) => JSON.parse(l));
}

function scoreTmdbVideo(v) {
  if (!v) return -Infinity;
  const site = String(v.site || '').toLowerCase();
  const type = String(v.type || '').toLowerCase();
  const name = String(v.name || '').toLowerCase();

  let score = 0;

  // Prefer embeddable platforms
  if (site === 'youtube') score += 1000;
  else if (site === 'vimeo') score += 800;
  else score += 50;

  // Prefer actual trailers
  if (type === 'trailer') score += 300;
  else if (type === 'teaser') score += 220;
  else if (type === 'clip') score += 60;
  else if (type === 'featurette') score += 40;
  else score += 20;

  if (v.official === true) score += 80;
  if (name.includes('official trailer')) score += 40;
  if (name.includes('trailer')) score += 10;

  const size = Number(v.size);
  if (Number.isFinite(size) && size > 0) score += Math.min(60, size / 10);

  if (String(v.iso_639_1 || '').toLowerCase() === 'en') score += 5;

  return score;
}

function videoUrlFor(v) {
  const site = String(v.site || '').toLowerCase();
  if (site === 'youtube') return `https://youtu.be/${v.key}`;
  if (site === 'vimeo') return `https://vimeo.com/${v.key}`;
  return v.url || '';
}

function tmdbPosterUrl(posterPath) {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/original${posterPath}`;
}

function runWithConcurrency(items, limit, worker) {
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    let active = 0;

    const launchNext = () => {
      while (active < limit && nextIndex < items.length) {
        const i = nextIndex++;
        active++;
        Promise.resolve(worker(items[i], i))
          .then((r) => {
            results[i] = r;
            active--;
            if (nextIndex >= items.length && active === 0) resolve(results);
            else launchNext();
          })
          .catch(reject);
      }
      if (items.length === 0) resolve([]);
    };

    launchNext();
  });
}

async function fetchTmdbDetailsWithVideos(tmdbId, language) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=videos&language=${encodeURIComponent(language || 'en-US')}`;
  const res = await axios.get(url);
  return res.data;
}

function safeString(v) {
  const s = String(v ?? '').trim();
  return s;
}

(async function main() {
  const args = parseArgs(process.argv);

  const movies = readMovies(args.limit);

  let existing = null;
  const outPath = path.resolve(args.outPath);
  if (args.resume && fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch {
      existing = null;
    }
  }

  const existingByTmdbId = new Map();
  if (existing && Array.isArray(existing.items)) {
    for (const it of existing.items) {
      const tmdbId = Number(it?.tmdbId);
      if (Number.isFinite(tmdbId) && tmdbId > 0) existingByTmdbId.set(tmdbId, it);
    }
  }

  console.log(`Local movies: ${movies.length}`);
  console.log(`Concurrency: ${args.concurrency}`);
  console.log(`Output: ${outPath}`);
  if (existingByTmdbId.size) console.log(`Resume: keeping ${existingByTmdbId.size} existing records`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  const items = await runWithConcurrency(movies, args.concurrency, async (movie, idx) => {
    const tmdbId = Number(movie?.tmdbId || movie?.tmdb_id || movie?.id);
    const imdbId = safeString(movie?.imdbId || movie?.imdbID || movie?.key);
    const title = safeString(movie?.title || movie?.originalTitle || movie?.name);
    const year = safeString(movie?.year || movie?.release_date);

    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      skipped++;
      return { tmdbId: null, imdbId, title, year, posterUrl: null, trailers: [] };
    }

    const cached = existingByTmdbId.get(tmdbId);
    if (cached) {
      ok++;
      return cached;
    }

    if ((idx + 1) % 25 === 0) {
      console.log(`Progress ${idx + 1}/${movies.length}... ok=${ok} skipped=${skipped} failed=${failed}`);
    }

    try {
      const d = await fetchTmdbDetailsWithVideos(tmdbId, args.language);
      const posterUrl = tmdbPosterUrl(d?.poster_path);

      const results = Array.isArray(d?.videos?.results) ? d.videos.results : [];
      const candidates = results
        .filter((v) => v && v.key && v.site)
        .slice()
        .sort((a, b) => scoreTmdbVideo(b) - scoreTmdbVideo(a));

      const trailers = candidates.slice(0, 5).map((v) => ({
        name: v.name || 'Trailer',
        site: v.site,
        type: v.type,
        key: v.key,
        url: videoUrlFor(v),
        official: v.official,
        size: v.size,
        published_at: v.published_at,
      })).filter((t) => t.url);

      ok++;
      return {
        tmdbId,
        imdbId,
        title: d?.title || title,
        year,
        posterUrl,
        trailers,
      };
    } catch (e) {
      failed++;
      return {
        tmdbId,
        imdbId,
        title,
        year,
        posterUrl: null,
        trailers: [],
        error: String(e?.message || e),
      };
    }
  });

  const cleanItems = items
    .filter(Boolean)
    .filter((it) => Number.isFinite(Number(it.tmdbId)) && Number(it.tmdbId) > 0);

  // Stable sort by tmdbId for deterministic diffs
  cleanItems.sort((a, b) => Number(a.tmdbId) - Number(b.tmdbId));

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'tmdb',
    limit: args.limit,
    items: cleanItems,
    stats: {
      totalInput: movies.length,
      totalOutput: cleanItems.length,
      ok,
      skipped,
      failed,
      withTrailer: cleanItems.filter((x) => Array.isArray(x.trailers) && x.trailers.length > 0).length,
      withPoster: cleanItems.filter((x) => x.posterUrl).length,
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log('Done.');
  console.log(JSON.stringify(out.stats, null, 2));
})();
