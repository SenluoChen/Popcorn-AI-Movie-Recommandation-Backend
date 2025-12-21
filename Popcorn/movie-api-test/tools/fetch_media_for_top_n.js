#!/usr/bin/env node
'use strict';

// Fetch poster/backdrop images and trailer URL for the first N movies in movies.ndjson
// Usage: node tools/fetch_media_for_top_n.js [N]

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const LOCAL_ROOT = path.resolve(process.env.LOCAL_DATA_PATH || path.join(__dirname, '..', '..', '..', 'Movie-data'));
const MOVIES_NDJSON = path.join(LOCAL_ROOT, 'movies', 'movies.ndjson');
const OUT_DIR = path.join(LOCAL_ROOT, 'movies', 'media');
const MANIFEST_PATH = path.join(LOCAL_ROOT, 'movies', 'media_manifest_top10.json');
// Load .env from project (if present)
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch (e) {
  // ignore
}

const TMDB_KEY = process.env.TMDB_API_KEY || process.env.TMDB_KEY || process.env.TMDB;

if (!TMDB_KEY) {
  console.error('Missing TMDB_API_KEY in environment. Set TMDB_API_KEY and retry.');
  process.exit(1);
}

const N = Number(process.argv[2] || 10);

function readTopNMovies(n) {
  if (!fs.existsSync(MOVIES_NDJSON)) throw new Error('movies.ndjson not found: ' + MOVIES_NDJSON);
  const lines = fs.readFileSync(MOVIES_NDJSON, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(0, n).map(l => JSON.parse(l));
}

async function fetchTmdbImagesAndVideosByTmdbId(tmdbId) {
  // images
  const imagesUrl = `https://api.themoviedb.org/3/movie/${tmdbId}/images?api_key=${TMDB_KEY}`;
  const videosUrl = `https://api.themoviedb.org/3/movie/${tmdbId}/videos?api_key=${TMDB_KEY}`;
  const [imgRes, vidRes] = await Promise.all([
    axios.get(imagesUrl).then(r => r.data).catch(() => null),
    axios.get(videosUrl).then(r => r.data).catch(() => null),
  ]);
  return { images: imgRes, videos: vidRes };
}

async function fetchTmdbIdFromImdb(imdbId) {
  // use TMDb find endpoint
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_KEY}&external_source=imdb_id`;
  try {
    const res = await axios.get(url);
    const data = res.data;
    if (data && Array.isArray(data.movie_results) && data.movie_results.length > 0) {
      return data.movie_results[0].id;
    }
  } catch (e) {
    // ignore
  }
  return null;
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
  else score += 100;

  // Prefer actual trailers
  if (type === 'trailer') score += 300;
  else if (type === 'teaser') score += 220;
  else if (type === 'clip') score += 80;
  else if (type === 'featurette') score += 60;
  else score += 40;

  if (v.official === true) score += 80;
  if (name.includes('official trailer')) score += 30;
  if (name.includes('trailer')) score += 10;

  // Prefer higher resolution when present
  const size = Number(v.size);
  if (Number.isFinite(size) && size > 0) score += Math.min(50, size / 10);

  // Slight preference for English metadata (best-effort)
  if (String(v.iso_639_1 || '').toLowerCase() === 'en') score += 5;

  return score;
}

function videoUrlFor(v) {
  const site = String(v.site || '').toLowerCase();
  if (site === 'youtube') return `https://youtu.be/${v.key}`;
  if (site === 'vimeo') return `https://vimeo.com/${v.key}`;
  // Fallbacks
  return v.url || `https://www.youtube.com/watch?v=${v.key}`;
}

function downloadUrlToFile(url, destPath) {
  return axios({ url, method: 'GET', responseType: 'stream' }).then(resp => new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    resp.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  }));
}

function tmdbImageUrl(pathSegment, size = 'original') {
  // use TMDb base url pattern; we will request original
  return `https://image.tmdb.org/t/p/${size}${pathSegment}`;
}

(async function main() {
  try {
    const movies = readTopNMovies(N);
    const manifest = [];
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const movie of movies) {
      const imdbId = String(movie.imdbId || movie.imdbID || movie.key || '').trim();
      const title = movie.title || movie.originalTitle || movie.name || '';
      const year = movie.year || movie.release_date || '';
      const idLabel = imdbId || `${title}|${year}`;
      const outFolder = path.join(OUT_DIR, idLabel.replace(/[:\\/\\*?"<>| ]+/g, '_'));
      if (!fs.existsSync(outFolder)) fs.mkdirSync(outFolder, { recursive: true });

      console.log(`Processing: ${title} (${idLabel})`);

      // Determine TMDb ID
      let tmdbId = movie.tmdbId || movie.tmdb_id || movie.id || null;
      if (!tmdbId && imdbId) {
        tmdbId = await fetchTmdbIdFromImdb(imdbId);
      }

      const record = { imdbId, title, year, tmdbId, images: [], trailers: [] };

      if (tmdbId) {
        const { images, videos } = await fetchTmdbImagesAndVideosByTmdbId(tmdbId);
        // posters: choose first poster
        if (images && Array.isArray(images.posters) && images.posters.length > 0) {
          const poster = images.posters[0];
          const posterUrl = tmdbImageUrl(poster.file_path);
          const posterPath = path.join(outFolder, 'poster' + path.extname(poster.file_path));
          try { await downloadUrlToFile(posterUrl, posterPath); record.images.push({ type: 'poster', path: posterPath, url: posterUrl }); } catch (e) { record.images.push({ type: 'poster', path: null, url: posterUrl }); }
        }
        // backdrops: take up to 3
        if (images && Array.isArray(images.backdrops) && images.backdrops.length > 0) {
          const tops = images.backdrops.slice(0, 3);
          let i = 1;
          for (const b of tops) {
            const bUrl = tmdbImageUrl(b.file_path);
            const bPath = path.join(outFolder, `backdrop_${i}` + path.extname(b.file_path));
            try { await downloadUrlToFile(bUrl, bPath); record.images.push({ type: 'backdrop', path: bPath, url: bUrl }); } catch (e) { record.images.push({ type: 'backdrop', path: null, url: bUrl }); }
            i += 1;
          }
        }
        // videos: pick best trailers (prefer YouTube Trailer + official)
        if (videos && Array.isArray(videos.results) && videos.results.length > 0) {
          const candidates = videos.results
            .filter(v => v && v.key && v.site)
            .slice()
            .sort((a, b) => scoreTmdbVideo(b) - scoreTmdbVideo(a));

          const picked = candidates.slice(0, 3);
          for (const t of picked) {
            record.trailers.push({
              name: t.name || 'Trailer',
              site: t.site,
              type: t.type,
              key: t.key,
              url: videoUrlFor(t),
              official: t.official,
              size: t.size,
            });
          }
        }
      } else {
        console.warn(`No TMDb id found for ${title} (${imdbId}). Skipping media fetch.`);
      }

      // save per-movie manifest file
      const movieManifestPath = path.join(outFolder, 'manifest.json');
      fs.writeFileSync(movieManifestPath, JSON.stringify(record, null, 2), 'utf8');
      manifest.push({ imdbId: idLabel, title, outFolder, manifest: movieManifestPath, images: record.images, trailers: record.trailers });
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), items: manifest }, null, 2), 'utf8');
    console.log('\nDone. Manifest written to:', MANIFEST_PATH);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
