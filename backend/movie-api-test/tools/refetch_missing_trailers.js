#!/usr/bin/env node
'use strict';

// Re-fetch trailers for manifest items that currently lack trailers.
// Usage: node tools/refetch_missing_trailers.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');

try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch {}

const MANIFEST = path.resolve(__dirname, '..', '..', '..', 'Movie-data', 'movies', 'media_manifest_1000.json');
const TMDB_KEY = process.env.TMDB_API_KEY || process.env.TMDB_KEY || process.env.TMDB;
if (!TMDB_KEY) {
  console.error('Missing TMDB_API_KEY in environment.');
  process.exit(1);
}

function scoreTmdbVideo(v) {
  if (!v) return -Infinity;
  const site = String(v.site || '').toLowerCase();
  const type = String(v.type || '').toLowerCase();
  const name = String(v.name || '').toLowerCase();

  let score = 0;
  if (site === 'youtube') score += 1000;
  else if (site === 'vimeo') score += 800;
  else score += 50;

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

async function fetchTmdbDetailsWithVideos(tmdbId, language) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=videos&language=${encodeURIComponent(language||'en-US')}`;
  const res = await axios.get(url);
  return res.data;
}

(async function main(){
  if (!fs.existsSync(MANIFEST)) {
    console.error('Manifest not found:', MANIFEST);
    process.exit(1);
  }

  const raw = fs.readFileSync(MANIFEST, 'utf8');
  const j = JSON.parse(raw);
  const items = Array.isArray(j.items) ? j.items : [];

  const missing = items.filter(it => !(Array.isArray(it.trailers) && it.trailers.length > 0));
  console.log('Missing trailers count:', missing.length);
  if (missing.length === 0) return console.log('Nothing to do.');

  const updated = [];
  for (const it of missing) {
    const tmdbId = Number(it.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;

    try {
      // Try English first
      const d = await fetchTmdbDetailsWithVideos(tmdbId, 'en-US');
      const results = Array.isArray(d?.videos?.results) ? d.videos.results : [];
      const candidates = results.filter(v => v && v.key && v.site).slice().sort((a,b)=>scoreTmdbVideo(b)-scoreTmdbVideo(a));
      const trailers = candidates.slice(0,5).map(v=>({
        name: v.name || 'Trailer',
        site: v.site,
        type: v.type,
        key: v.key,
        url: videoUrlFor(v),
        official: v.official,
        size: v.size,
        published_at: v.published_at,
      })).filter(t=>t.url);

      if (trailers.length === 0) {
        // Try original language fallback
        const d2 = await fetchTmdbDetailsWithVideos(tmdbId, '');
        const results2 = Array.isArray(d2?.videos?.results) ? d2.videos.results : [];
        const candidates2 = results2.filter(v=> v && v.key && v.site).slice().sort((a,b)=>scoreTmdbVideo(b)-scoreTmdbVideo(a));
        const trailers2 = candidates2.slice(0,5).map(v=>({
          name: v.name || 'Trailer',
          site: v.site,
          type: v.type,
          key: v.key,
          url: videoUrlFor(v),
          official: v.official,
          size: v.size,
          published_at: v.published_at,
        })).filter(t=>t.url);
        if (trailers2.length) {
          it.trailers = trailers2;
          it.posterUrl = it.posterUrl || tmdbPosterUrl(d2?.poster_path);
          updated.push(it.tmdbId);
          console.log('Found (fallback) tmdbId=', tmdbId, 'trailers=', trailers2.length);
          continue;
        }
      }

      if (trailers.length) {
        it.trailers = trailers;
        it.posterUrl = it.posterUrl || tmdbPosterUrl(d?.poster_path);
        updated.push(it.tmdbId);
        console.log('Found tmdbId=', tmdbId, 'trailers=', trailers.length);
      } else {
        console.log('No trailers for tmdbId=', tmdbId);
      }
    } catch (e) {
      console.error('Error tmdbId=', it.tmdbId, e?.message || e);
    }
  }

  // Update manifest
  if (updated.length) {
    j.generatedAt = new Date().toISOString();
    fs.writeFileSync(MANIFEST, JSON.stringify(j, null, 2), 'utf8');
    console.log('Updated manifest, items updated:', updated.length);
  } else {
    console.log('No updates made.');
  }
})();
