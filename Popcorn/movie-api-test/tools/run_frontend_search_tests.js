const fs = require('fs');
const path = require('path');

// Load env in a way that matches the frontend config.
// Prefer Popcorn/.env.local (contains REACT_APP_RELIVRE_API_URL), then fall back to movie-api-test/.env.
try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local') });
} catch {}
try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch {}
// Use global fetch available in Node 18+; no external dependency required.
const fetch = global.fetch;

function getApiBase() {
  const envUrl = process.env.REACT_APP_RELIVRE_API_URL || process.env.REACT_APP_API_URL;
  if (envUrl && String(envUrl).trim()) return String(envUrl).trim().replace(/\/$/, '');
  // fallback to known deployed endpoint (from repo env)
  return 'https://olc433bmpe.execute-api.eu-west-3.amazonaws.com';
}

const API_BASE = getApiBase();
const ENDPOINT = `${API_BASE}/search`;

const QUERIES = [
  { name: 'relaxing_not_horror_zh', q: '想看放鬆、不血腥、不要恐怖' },
  { name: 'romantic_not_too_sad_en', q: 'romantic but not too sad' },
  { name: 'family_fun', q: '適合全家一起看的歡樂電影' },
  { name: 'suspense_chinese', q: '懸疑緊張，不要太暴力' },
  { name: 'alien_adventure', q: '外星人冒險、刺激、想要輕鬆感' },
];

async function runOne(q, topK) {
  const body = { query: q, topK };
  const start = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const dur = Date.now() - start;
  let data = null;
  try { data = await res.json(); } catch (e) { data = { parseError: String(e) }; }
  return { query: q, status: res.status, ok: res.ok, durationMs: dur, data };
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name, def) => {
    const i = args.indexOf(name);
    if (i === -1) return def;
    const v = args[i + 1];
    return v == null ? def : v;
  };

  const runs = Math.max(1, Math.min(50, Number(getArg('--runs', '5')) || 5));
  const topK = Math.max(1, Math.min(20, Number(getArg('--topK', '12')) || 12));
  const maxAvgMs = Math.max(100, Number(getArg('--maxAvgMs', '3000')) || 3000);

  console.log('API endpoint:', ENDPOINT);
  console.log(`Config: runs=${runs} topK=${topK} maxAvgMs=${maxAvgMs}`);

  const results = [];
  const times = [];

  // Warmup (1 request) to avoid cold-start skew
  try {
    await runOne(QUERIES[0].q, topK);
  } catch {}

  for (let pass = 1; pass <= runs; pass++) {
    for (const item of QUERIES) {
      try {
        const r = await runOne(item.q, topK);
        const top = Array.isArray(r.data?.results) && r.data.results.length > 0 ? r.data.results[0] : null;
        results.push({ pass, name: item.name, query: item.q, status: r.status, ok: r.ok, durationMs: r.durationMs, top });
        if (r.ok) times.push(r.durationMs);
        console.log(`${pass}/${runs} ${item.name} | ok=${r.ok} status=${r.status} time=${r.durationMs}ms`);
      } catch (e) {
        console.error('Error for', item.name, e?.message || e);
        results.push({ pass, name: item.name, error: String(e) });
      }
    }
  }

  const okCount = results.filter(r => r && r.ok).length;
  const sorted = times.slice().sort((a, b) => a - b);
  const avg = sorted.length ? (sorted.reduce((a, b) => a + b, 0) / sorted.length) : null;
  const p95 = sorted.length ? percentile(sorted, 0.95) : null;
  const p99 = sorted.length ? percentile(sorted, 0.99) : null;

  console.log('----');
  console.log(`okRequests=${okCount}/${results.length}`);
  console.log(`avgMs=${avg != null ? avg.toFixed(1) : 'n/a'} p95Ms=${p95 ?? 'n/a'} p99Ms=${p99 ?? 'n/a'}`);
  const passGate = avg != null && avg < maxAvgMs;
  console.log(`GATE: avg < ${maxAvgMs}ms => ${passGate ? 'PASS' : 'FAIL'}`);

  const out = path.join(__dirname, 'frontend_search_test_results.json');
  fs.writeFileSync(out, JSON.stringify({
    timestamp: new Date().toISOString(),
    api: ENDPOINT,
    config: { runs, topK, maxAvgMs },
    summary: { okRequests: okCount, totalRequests: results.length, avgMs: avg, p95Ms: p95, p99Ms: p99, pass: passGate },
    results,
  }, null, 2), 'utf8');
  console.log('Wrote:', out);

  if (!passGate) {
    process.exitCode = 2;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
