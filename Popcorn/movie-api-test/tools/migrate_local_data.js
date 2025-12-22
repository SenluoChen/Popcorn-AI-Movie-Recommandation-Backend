/*
  Migrate legacy Movie-data layout (single JSON array movie_data.json) into
  LOCAL_DATA_PATH NDJSON layout:

  movies/movies.ndjson  (metadata only, append-friendly)
  vectors/embeddings.ndjson  (embeddings only)
  index/{faiss.index,meta.json}

  Usage:
  LOCAL_DATA_PATH=C:\\Path\\To\\Movie-data node tools/migrate_local_data.js

  Notes:
  — Streaming parser: does not load the full JSON array into memory.
  — Writes NDJSON in a single pass.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const { once } = require('events');

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(v);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stableKey(movie) {
  const imdbId = String(movie?.imdbId || '').trim();
  if (imdbId) return imdbId;
  const id = String(movie?.id || '').trim();
  if (id) return id;
  const title = String(movie?.title || '').trim().toLowerCase();
  const year = String(movie?.year || '').trim();
  if (title && year) return `${title}|${year}`;
  if (title) return `title:${title}`;
  return '';
}

async function writeLine(stream, obj) {
  const ok = stream.write(`${JSON.stringify(obj)}\n`);
  if (!ok) {
    await once(stream, 'drain');
  }
}

async function closeStream(stream) {
  stream.end();
  await once(stream, 'finish');
}

async function convertMovieDataJsonArrayToNdjson({ src, moviesOutPath, vectorsOutPath }) {
  const moviesOut = fs.createWriteStream(moviesOutPath, { flags: 'w', encoding: 'utf8' });
  const vectorsOut = fs.createWriteStream(vectorsOutPath, { flags: 'w', encoding: 'utf8' });

  let processed = 0;
  let wroteMovies = 0;
  let wroteVectors = 0;
  let skipped = 0;

  const input = fs.createReadStream(src, { encoding: 'utf8' });

  let inString = false;
  let escape = false;
  let depth = 0;
  let buf = '';
  let started = false;

  const flushObject = async () => {
    if (!buf) return;
    processed += 1;
    let obj;
    try {
      obj = JSON.parse(buf);
    } catch {
      skipped += 1;
      buf = '';
      return;
    }

    if (!obj || typeof obj !== 'object') {
      skipped += 1;
      buf = '';
      return;
    }

    const key = stableKey(obj);
    if (!key) {
      skipped += 1;
      buf = '';
      return;
    }

    const vector = obj.vector;
    const meta = { ...obj, key };
    delete meta.vector;

    await writeLine(moviesOut, meta);
    wroteMovies += 1;

    if (Array.isArray(vector) && vector.length > 0) {
      await writeLine(vectorsOut, { key, imdbId: obj.imdbId, vector });
      wroteVectors += 1;
    }

    if (processed % 25 === 0) {
      process.stdout.write(`\rProcessed ${processed} movies...`);
    }

    buf = '';
  };

  try {
    for await (const chunk of input) {
      const s = String(chunk);
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];

        if (!started) {
          if (ch === '[') {
            started = true;
          }
          continue;
        }

        if (depth === 0) {
          if (ch === '{') {
            depth = 1;
            buf = '{';
            inString = false;
            escape = false;
          } else {
            // skip commas, whitespace, closing bracket
          }
          continue;
        }

        // We are inside an object
        buf += ch;

        if (inString) {
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === '\\') {
            escape = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }

        if (ch === '{') {
          depth += 1;
          continue;
        }

        if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            await flushObject();
          }
        }
      }
    }

    // best-effort flush
    if (depth === 0 && buf) {
      await flushObject();
    }
  } finally {
    await closeStream(moviesOut);
    await closeStream(vectorsOut);
  }

  process.stdout.write('\n');
  console.log(`[OK] Read: ${src}`);
  console.log(`[OK] Wrote movies: ${moviesOutPath} (${wroteMovies} line(s))`);
  console.log(`[OK] Wrote vectors: ${vectorsOutPath} (${wroteVectors} line(s))`);
  console.log(`[OK] Skipped: ${skipped}`);
}

async function main() {
  const root = path.resolve(requireEnv('LOCAL_DATA_PATH'));
  const moviesDir = path.join(root, 'movies');
  const vectorsDir = path.join(root, 'vectors');
  const indexDir = path.join(root, 'index');
  const logsDir = path.join(root, 'logs');

  ensureDir(moviesDir);
  ensureDir(vectorsDir);
  ensureDir(indexDir);
  ensureDir(logsDir);

  // Legacy locations (best-effort)
  const legacyMovieDataCandidates = [
    path.join(root, 'movies', 'movie_data.json'),
    path.join(root, 'movies', 'movie-vectors', 'movie_data.json'),
    path.join(root, 'movies', 'movie-vectors', 'movie_data.ndjson'),
    path.join(root, 'logs', 'movie_data.json'),
  ];

  const legacyMovieData = legacyMovieDataCandidates.find(p => fs.existsSync(p));
  if (!legacyMovieData) {
    throw new Error(`Cannot find legacy movie_data.json under ${root}`);
  }

  const moviesOutPath = path.join(moviesDir, 'movies.ndjson');
  const vectorsOutPath = path.join(vectorsDir, 'embeddings.ndjson');

  console.log(`[Migrate] LOCAL_DATA_PATH=${root}`);
  console.log(`[Migrate] Source: ${legacyMovieData}`);

  await convertMovieDataJsonArrayToNdjson({
    src: legacyMovieData,
    moviesOutPath,
    vectorsOutPath,
  });

  const convertJsonArrayFileToNdjson = (srcPath, dstPath) => {
    if (!fs.existsSync(srcPath) || fs.existsSync(dstPath)) return;
    const raw = fs.readFileSync(srcPath, 'utf8');
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(arr)) return;
    const out = fs.createWriteStream(dstPath, { flags: 'w', encoding: 'utf8' });
    for (const item of arr) {
      out.write(`${JSON.stringify(item)}\n`);
    }
    out.end();
    console.log(`[OK] Converted: ${srcPath} -> ${dstPath}`);
  };

  // Move/copy titles and seed cache into new expected location
  const maybeCopy = (src, dst) => {
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      console.log(`[OK] Copied: ${src} -> ${dst}`);
    }
  };

  maybeCopy(path.join(root, 'logs', 'movie_titles.json'), path.join(moviesDir, 'movie_titles.json'));
  const popularSeedsJson = path.join(moviesDir, 'build_popular_seeds.json');
  const topRatedSeedsJson = path.join(moviesDir, 'build_top_rated_seeds.json');
  const highRatedSeedsJson = path.join(moviesDir, 'build_high_rated_seeds.json');
  maybeCopy(path.join(root, 'logs', 'build_popular_seeds.json'), popularSeedsJson);
  maybeCopy(path.join(root, 'logs', 'build_top_rated_seeds.json'), topRatedSeedsJson);
  maybeCopy(path.join(root, 'logs', 'build_high_rated_seeds.json'), highRatedSeedsJson);

  convertJsonArrayFileToNdjson(popularSeedsJson, path.join(moviesDir, 'build_popular_seeds.ndjson'));
  convertJsonArrayFileToNdjson(topRatedSeedsJson, path.join(moviesDir, 'build_top_rated_seeds.ndjson'));
  convertJsonArrayFileToNdjson(highRatedSeedsJson, path.join(moviesDir, 'build_high_rated_seeds.ndjson'));

  console.log('[Migrate] Done.');
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
