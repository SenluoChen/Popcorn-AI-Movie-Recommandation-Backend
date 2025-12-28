const fs = require('fs');
const path = require('path');
// Load local .env if present (movie-api-test/.env)
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); } catch (e) {}
const fetch = global.fetch || require('node-fetch');

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]), y = Number(b[i]);
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function loadLocalVectors(filePath, max = 50000) {
  const abs = path.resolve(filePath);
  const s = fs.readFileSync(abs, 'utf8');
  const lines = s.split('\n').filter(Boolean);
  const out = [];
  for (let i = 0; i < Math.min(lines.length, max); i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && obj.imdbId && Array.isArray(obj.vector)) out.push(obj);
    } catch (e) {}
  }
  return out;
}

async function getEmbedding(apiKey, model, input) {
  const url = 'https://api.openai.com/v1/embeddings';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) throw new Error(`Embeddings failed: ${res.status}`);
  const j = await res.json();
  return j?.data?.[0]?.embedding;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY in environment (movie-api-test/.env will be used if present).');
    process.exit(2);
  }
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  // Try several likely locations for Movie-data/vectors/embeddings.ndjson
  const candidates = [
    path.join(__dirname, '..', '..', 'Movie-data', 'vectors', 'embeddings.ndjson'),
    path.join(__dirname, '..', '..', '..', 'Movie-data', 'vectors', 'embeddings.ndjson'),
    path.join(__dirname, '..', '..', '..', '..', 'Movie-data', 'vectors', 'embeddings.ndjson'),
  ];
  let vectorsFile = null;
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { vectorsFile = c; break; } } catch (e) {}
  }
  if (!vectorsFile) {
    console.error('Could not find Movie-data/vectors/embeddings.ndjson. Tried:', candidates.join(', '));
    process.exit(2);
  }

  console.log('Loading local vectors (first 2000 entries) from', vectorsFile);
  const movies = await loadLocalVectors(vectorsFile, 2000);
  console.log(`Loaded ${movies.length} local vectors.`);

  const QUERIES = [
    { lang: 'zh', q: '想看放鬆、不血腥、不要恐怖' },
    { lang: 'en', q: 'relaxing, not bloody, not horror' },
    { lang: 'es', q: 'relajante, no sangriento, no terror' },
  ];

  for (const item of QUERIES) {
    console.log('\n=== QUERY:', item.lang, item.q);
    const emb = await getEmbedding(apiKey, model, item.q);
    if (!emb) { console.error('No embedding returned'); continue; }
    const scored = movies.map(m => ({ imdbId: m.imdbId, score: cosine(emb, m.vector) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 10);
    for (let i = 0; i < top.length; i++) {
      console.log(`${i + 1}. ${top[i].imdbId}  sim=${top[i].score.toFixed(4)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
