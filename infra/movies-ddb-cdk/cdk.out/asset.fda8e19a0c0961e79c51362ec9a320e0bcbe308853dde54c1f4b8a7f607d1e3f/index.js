'use strict';

// Minimal, dependency-free Lambda:
// - Uses global fetch (Node.js 18+)
// - Uses aws-sdk v2 (included in Lambda Node.js runtime)
// - Scans DynamoDB, computes cosine similarity locally

const AWS = require('aws-sdk');

let cachedOpenAiKey = null;

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'OPTIONS,POST,GET',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function normalizeQueryText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function cosineSimilarity(vec1, vec2) {
  if (!Array.isArray(vec1) || !Array.isArray(vec2) || vec1.length === 0 || vec2.length === 0) return 0;
  if (vec1.length !== vec2.length) return 0;

  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    const a = Number(vec1[i]);
    const b = Number(vec2[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    norm1 += a * a;
    norm2 += b * b;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableOpenAI(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function openaiEmbeddings({ apiKey, model, input, maxAttempts = 6 }) {
  const url = 'https://api.openai.com/v1/embeddings';

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, input }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`OpenAI embeddings failed: status=${resp.status} body=${text.slice(0, 400)}`);
        err.status = resp.status;
        throw err;
      }

      const data = await resp.json();
      const embedding = data?.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('OpenAI embeddings returned empty embedding');
      }
      return embedding;
    } catch (e) {
      lastErr = e;
      const status = e?.status;
      if (attempt === maxAttempts || (typeof status === 'number' && !isRetryableOpenAI(status))) {
        throw e;
      }
      const backoff = Math.min(12000, 800 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }

  throw lastErr;
}

async function resolveOpenAiApiKey() {
  if (cachedOpenAiKey) {
    return cachedOpenAiKey;
  }

  const direct = process.env.OPENAI_API_KEY;
  if (direct && String(direct).trim()) {
    cachedOpenAiKey = String(direct).trim();
    return cachedOpenAiKey;
  }

  const paramName = process.env.OPENAI_API_KEY_SSM_PARAM;
  if (!paramName || !String(paramName).trim()) {
    throw new Error('Missing OPENAI_API_KEY (or OPENAI_API_KEY_SSM_PARAM) in Lambda env');
  }

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const ssm = new AWS.SSM(region ? { region } : {});
  const resp = await ssm.getParameter({ Name: String(paramName).trim(), WithDecryption: true }).promise();
  const value = resp?.Parameter?.Value;
  if (!value || !String(value).trim()) {
    throw new Error(`SSM parameter empty: ${paramName}`);
  }

  cachedOpenAiKey = String(value).trim();
  return cachedOpenAiKey;
}

async function scanAllMovies({ tableName, region, maxItems }) {
  const ddb = new AWS.DynamoDB.DocumentClient({ region });

  const items = [];
  let lastKey = undefined;

  do {
    const resp = await ddb
      .scan({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        Limit: 1000,
      })
      .promise();

    const batch = Array.isArray(resp?.Items) ? resp.Items : [];
    for (const item of batch) {
      items.push(item);
      if (maxItems && items.length >= maxItems) {
        return items;
      }
    }

    lastKey = resp?.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

function pickTopK(results, k) {
  const top = [];
  for (const r of results) {
    if (!r || !isFiniteNumber(r.similarity)) continue;
    if (top.length < k) {
      top.push(r);
      top.sort((a, b) => b.similarity - a.similarity);
      continue;
    }
    if (r.similarity > top[top.length - 1].similarity) {
      top[top.length - 1] = r;
      top.sort((a, b) => b.similarity - a.similarity);
    }
  }
  return top;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event?.requestContext?.http?.method === 'OPTIONS') {
    return json(204, {}, { 'content-length': '0' });
  }

  const tableName = process.env.DDB_TABLE_NAME || 'reLivre-movies';
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

  if (!region) {
    return json(500, { error: 'Missing AWS region (AWS_REGION)' });
  }
  let apiKey;
  try {
    apiKey = await resolveOpenAiApiKey();
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }

  let body = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const query = normalizeQueryText(body?.query);
  const topK = Math.max(1, Math.min(20, Number(body?.topK || 5)));
  const maxScan = body?.maxScan ? Number(body.maxScan) : null;

  if (!query) {
    return json(400, { error: 'Missing query' });
  }

  try {
    const queryVector = await openaiEmbeddings({ apiKey, model, input: query });

    const movies = await scanAllMovies({ tableName, region, maxItems: Number.isFinite(maxScan) && maxScan > 0 ? Math.floor(maxScan) : null });

    const scored = [];
    for (const m of movies) {
      const vec = m?.vector;
      const title = m?.title;
      const imdbId = m?.imdbId;
      if (!title || !imdbId || !Array.isArray(vec)) continue;

      const similarity = cosineSimilarity(queryVector, vec);
      scored.push({
        imdbId,
        title,
        year: m?.year,
        similarity,
        productionCountry: m?.productionCountry,
      });
    }

    const top = pickTopK(scored, topK);
    return json(200, {
      query,
      countScanned: movies.length,
      countScored: scored.length,
      topK,
      results: top,
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: String(e?.message || e) });
  }
};
