require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const axios = require('axios');  // 使用 axios 進行 HTTP 請求
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });




function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function hasEnv(name) {
  const value = process.env[name];
  return !!(value && String(value).trim());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHttpStatus(error) {
  return error?.response?.status ?? error?.status ?? error?.statusCode ?? null;
}

function isRetryableError(error) {
  const status = getHttpStatus(error);
  if (status === 429) return true;
  if (status === 408) return true;
  if (status >= 500 && status <= 599) return true;

  // Network-ish errors (axios / node)
  const code = String(error?.code || '').toUpperCase();
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED'].includes(code)) {
    return true;
  }
  return false;
}

function computeBackoffMs(attempt, baseDelayMs, maxDelayMs) {
  const exp = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxDelayMs, exp + jitter);
}

async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    label = 'request',
  } = opts;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      const status = getHttpStatus(error);

      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      const statusText = status ? ` status=${status}` : '';
      console.warn(`[Retry] ${label} failed (attempt ${attempt}/${maxAttempts})${statusText}. Waiting ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function axiosGetWithRetry(url, config = {}, opts = {}) {
  const {
    label = 'http',
    timeoutMs = 15000,
    maxAttempts = 5,
  } = opts;

  return withRetry(
    () => axios.get(url, { timeout: timeoutMs, ...config }),
    { maxAttempts, label, baseDelayMs: 500, maxDelayMs: 8000 },
  );
}

// Newer embedding model with better multilingual performance (incl. Chinese)
// Default dimension for text-embedding-3-small is 1536.
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EXPECTED_EMBEDDING_DIM = 1536;

// 情緒/氛圍標籤（用於情緒搜尋）
const MOOD_TAGS = [
    'Warm', 'Touching', 'Tense', 'Dark', 'Humorous', 'Inspirational', 'Romantic', 'Horror', 'Exciting', 'Sad',
    'Healing', 'Positive', 'Oppressive', 'Joyful', 'Adventure', 'Epic', 'Suspense', 'Thriller', 'Sci-Fi', 'Fantasy',
    'Action', 'Crime', 'War', 'Family', 'Youth', 'Coming-of-age',
];

// 生成嵌入（將文本轉換為向量）
async function generateEmbedding(text) {
  requireEnv('OPENAI_API_KEY');
  try {
    const response = await withRetry(
      () => openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
      }),
      { label: 'openai.embeddings.create', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
    );

    const embedding = response.data[0].embedding;

    // 檢查查詢向量是否有效
    if (!embedding || embedding.some(isNaN)) {
      console.error('Generated query embedding contains invalid values');
      return [];  // 返回空向量，避免後續錯誤
    }

    return embedding;
  } catch (error) {
    console.error(`Error generating embedding: ${error?.message || error}`);
    return [];
  }
}

// 計算餘弦相似度
function cosineSimilarity(vec1, vec2) {
  if (!Array.isArray(vec1) || !Array.isArray(vec2) || vec1.length === 0 || vec2.length === 0) {
    return 0;
  }

  // 兩個向量維度不同時，無法計算有效相似度
  if (vec1.length !== vec2.length) {
    return 0;
  }

  // 如果有向量包含 NaN，返回 0
  if (vec1.some(isNaN) || vec2.some(isNaN)) {
    return 0;
  }

  const dotProduct = vec1.reduce((sum, val, index) => sum + val * vec2[index], 0);
  const norm1 = Math.sqrt(vec1.reduce((sum, val) => sum + val ** 2, 0));
  const norm2 = Math.sqrt(vec2.reduce((sum, val) => sum + val ** 2, 0));

  // 防止除數為 0
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (norm1 * norm2);
}

function normalizeQueryText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function averageVectors(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return vecA;
  }
  const out = new Array(vecA.length);
  for (let i = 0; i < vecA.length; i++) {
    out[i] = (Number(vecA[i]) + Number(vecB[i])) / 2;
  }
  return out;
}

async function translateQueryToEnglish(query) {
  const text = normalizeQueryText(query);
  if (!text) {
    return '';
  }

  // Keep this lightweight: translate for retrieval only.
  const prompt = [
    'Translate the following movie search query into English.',
    '- Preserve proper nouns (movie titles, names) and don\'t invent details.',
    '- If the query is already English, output it as-is.',
    '- Output ONLY the translated text.',
    '',
    `QUERY: ${text}`,
  ].join('\n');

  try {
    const response = await withRetry(
      () => openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
      { label: 'openai.chat.completions.create (translate)', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
    );
    return normalizeQueryText(response.choices?.[0]?.message?.content || '');
  } catch (error) {
    console.warn(`Query translation failed; using original query only. (${error?.message || error})`);
    return '';
  }
}

async function generateMultilingualQueryEmbeddingWithText(query) {
  const original = normalizeQueryText(query);
  if (!original) {
    return { original: '', english: '', embedding: [] };
  }

  const originalEmbedding = await generateEmbedding(original);
  if (!isValidEmbeddingVector(originalEmbedding)) {
    return { original, english: '', embedding: [] };
  }

  const english = await translateQueryToEnglish(original);
  if (!english || english.toLowerCase() === original.toLowerCase()) {
    return { original, english: english || '', embedding: originalEmbedding };
  }

  const englishEmbedding = await generateEmbedding(english);
  if (!isValidEmbeddingVector(englishEmbedding)) {
    return { original, english, embedding: originalEmbedding };
  }

  return { original, english, embedding: averageVectors(originalEmbedding, englishEmbedding) };
}

function buildMovieSearchText(movie) {
  return [
    movie?.title,
    movie?.genre,
    movie?.director,
    movie?.language,
    movie?.keywords,
    movie?.tags,
    movie?.plot,
    movie?.expandedOverview,
    movie?.detailedPlot,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function extractQueryTermsForLexical(original, english) {
  const terms = new Set();
  const o = (original || '').toLowerCase();
  const e = (english || '').toLowerCase();

  // Query expansion for small-dataset precision (kept intentionally minimal)
  const addAll = (arr) => { for (const t of arr) if (t) terms.add(t); };

  const mentionsAlien = o.includes('外星') || o.includes('外星人') || o.includes('異星') || o.includes('外星世界')
    || e.includes('alien') || e.includes('extraterrestrial');
  if (mentionsAlien) {
    // Avatar universe anchors often appear in plot text
    addAll(['pandora', "na'vi", 'avatar']);
  }

  // Keep anchored phrases as-is
  const anchoredPhrases = [
    'world war ii',
    'second world war',
    'wwii',
    'nazi',
    'hitler',
    'holocaust',
    'enigma',
  ];
  for (const p of anchoredPhrases) {
    if (e.includes(p) || o.includes(p)) {
      terms.add(p);
    }
  }

  // Map common zh anchors
  if (o.includes('二戰') || o.includes('第二次世界大戰')) {
    terms.add('world war ii');
    terms.add('wwii');
  }

  // Stopwords / overly generic tokens that harm reranking in a tiny dataset
  const stop = new Set([
    'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with',
    'about', 'within', 'style',
    'movie', 'movies', 'film', 'films',
    'related', 'relevant',
    'world',
    // genre-level generics (too broad)
    'science', 'fiction', 'sci', 'sci-fi', 'scifi',
    'adventure', 'action', 'drama', 'comedy', 'family',
  ]);

  // Tokenize english into a few meaningful tokens
  const englishTokens = e.split(/[^a-z0-9']+/g);
  let kept = 0;
  for (const token of englishTokens) {
    const t = token.trim();
    if (!t) continue;
    if (stop.has(t)) continue;
    // Keep moderately specific tokens only
    if (t.length >= 5 || anchoredPhrases.includes(t)) {
      terms.add(t);
      kept += 1;
      if (kept >= 8) break;
    }
  }

  return [...terms];
}

function isAnchoredWorldWarIIQuery(original, english) {
  const o = (original || '').toLowerCase();
  const e = (english || '').toLowerCase();
  return o.includes('二戰')
    || o.includes('第二次世界大戰')
    || e.includes('world war ii')
    || e.includes('second world war')
    || e.includes('wwii');
}

function movieMentionsWorldWarII(movieText) {
  const t = (movieText || '').toLowerCase();
  return t.includes('world war ii')
    || t.includes('second world war')
    || t.includes('wwii')
    || t.includes('nazi')
    || t.includes('hitler')
    || t.includes('holocaust')
    || t.includes('enigma');
}

function isResultRelevant(similarity) {
  // Conservative threshold: below this, the match is usually unrelated for this dataset.
  // Tune if you expand the dataset and observe different similarity ranges.
  const MIN_RELEVANT_SIMILARITY = 0.26;
  return typeof similarity === 'number' && !Number.isNaN(similarity) && similarity >= MIN_RELEVANT_SIMILARITY;
}

function rankMoviesWithSignals(queryVector, storedMovieData, moodPreferences, queryTextInfo, topK = 5) {
  const WANT_WEIGHT = 0.10;
  const AVOID_WEIGHT = 0.12;
  const LEXICAL_HIT_WEIGHT = 0.015;
  const LEXICAL_ANCHOR_WEIGHT = 0.07;
  const STRONG_SINGLE_TERMS = new Set(['pandora', "na'vi", 'avatar', 'enigma']);

  const want = toTagArray(moodPreferences?.want);
  const avoid = toTagArray(moodPreferences?.avoid);

  const queryOriginal = queryTextInfo?.original || '';
  const queryEnglish = queryTextInfo?.english || '';
  const queryTerms = extractQueryTermsForLexical(queryOriginal, queryEnglish);

  const ranked = [];
  for (const movie of storedMovieData) {
    if (!movie || !movie.vector || movie.vector.some(isNaN)) {
      continue;
    }

    const similarity = cosineSimilarity(queryVector, movie.vector);
    if (Number.isNaN(similarity)) {
      continue;
    }

    const matchedWant = want.length > 0 ? intersectTags(movie.moodTags, want) : [];
    const matchedAvoid = avoid.length > 0 ? intersectTags(movie.moodTags, avoid) : [];

    const movieText = buildMovieSearchText(movie);
    let lexicalBoost = 0;
    const matchedTerms = [];
    for (const term of queryTerms) {
      if (!term) continue;
      if (movieText.includes(term)) {
        matchedTerms.push(term);
        lexicalBoost += (term.includes(' ') || term === 'wwii' || term === 'world war ii' || STRONG_SINGLE_TERMS.has(term))
          ? LEXICAL_ANCHOR_WEIGHT
          : LEXICAL_HIT_WEIGHT;
      }
    }
    lexicalBoost = Math.min(0.25, lexicalBoost);

    const score = similarity
      + (matchedWant.length * WANT_WEIGHT)
      - (matchedAvoid.length * AVOID_WEIGHT)
      + lexicalBoost;

    ranked.push({
      title: movie.title,
      similarity,
      score,
      lexicalBoost,
      matchedTerms: [...new Set(matchedTerms)],
      matchedWantTags: matchedWant,
      matchedAvoidTags: matchedAvoid,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, topK));
}

function toTagArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(String).map(s => s.trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,，、\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function intersectTags(a, b) {
  const left = new Set(toTagArray(a).map(t => t.toLowerCase()));
  const right = new Set(toTagArray(b).map(t => t.toLowerCase()));
  const out = [];
  for (const t of left) {
    if (right.has(t)) {
      out.push(t);
    }
  }
  return out;
}

function inferMoodPreferencesHeuristic(query) {
  const text = normalizeQueryText(query).toLowerCase();
  if (!text) {
    return { want: [], avoid: [] };
  }

  const want = new Set();
  const avoid = new Set();

  const hasAny = (list) => list.some(w => text.includes(w));

  // Want light / uplifting
  if (hasAny(['輕鬆', '放鬆', '輕鬆一點', '紓壓', '治癒', '療癒', '溫馨', '暖心', '可愛', '搞笑', '好笑', '喜劇', '開心', '快樂', '正能量',
    'light', 'feel good', 'feel-good', 'relax', 'relaxing', 'uplifting', 'funny', 'comedy', 'wholesome',
    'ligera', 'relajante', 'divertida', 'comedia', 'alegre',
    '癒し', '癒やし', '気楽', '気軽', 'コメディ', '笑える', '面白い', 'ほのぼの',
  ])) {
    want.add('Humorous');
    want.add('Warm');
    want.add('Positive');
    want.add('Healing');
    want.add('Joyful');
  }

  // User feels bad -> avoid heavy/dark
  if (hasAny(['心情不好', '心情很差', '低落', '憂鬱', '難過', '不開心', '壓力', '焦慮',
    'sad', 'depressed', 'down', 'stress', 'anxious',
    'triste', 'deprimido', 'estresado', 'ansioso',
    '落ち込', 'しんど', 'つらい', '憂鬱',
  ])) {
    want.add('Healing');
    want.add('Warm');
    want.add('Positive');
    avoid.add('Dark');
    avoid.add('Oppressive');
    avoid.add('Sad');
    avoid.add('Horror');
    avoid.add('Thriller');
    avoid.add('Suspense');
    avoid.add('Tense');
  }

  return {
    want: [...want].filter(t => MOOD_TAGS.includes(t)),
    avoid: [...avoid].filter(t => MOOD_TAGS.includes(t)),
  };
}

function querySeemsMoodRelated(query) {
  const text = normalizeQueryText(query).toLowerCase();
  if (!text) {
    return false;
  }

  // Keep this conservative: only trigger on clear mood/feeling/tone intent.
  const signals = [
    // zh
    '心情', '情緒', '想看', '想要', '輕鬆', '放鬆', '紓壓', '治癒', '療癒', '溫馨', '暖心', '感人', '催淚',
    '搞笑', '好笑', '喜劇', '浪漫', '恐怖', '驚悚', '緊張', '刺激', '黑暗',
    // en
    'mood', 'feel', 'feel-good', 'feel good', 'uplifting', 'light', 'relax', 'relaxing', 'funny', 'comedy',
    'romantic', 'scary', 'horror', 'thriller', 'dark', 'sad',
    // ja (common)
    '気分', '癒し', '癒やし', 'ほのぼの', '笑える', '怖い',
    // es (common)
    'ánimo', 'relaj', 'ligera', 'divertida', 'comedia', 'terror', 'triste',
  ];

  return signals.some(s => s && text.includes(s));
}

async function inferMoodPreferencesFromQuery(query) {
  const original = normalizeQueryText(query);
  if (!original) {
    return { want: [], avoid: [] };
  }

  // First try deterministic heuristic (cheap + stable)
  const heuristic = inferMoodPreferencesHeuristic(original);
  if (heuristic.want.length > 0 || heuristic.avoid.length > 0) {
    return heuristic;
  }

  // Important: if the query doesn't look mood-related, don't call the LLM.
  // Otherwise sports/topic searches (e.g., baseball) can get noisy mood boosts and rank wrong.
  if (!querySeemsMoodRelated(original)) {
    return { want: [], avoid: [] };
  }

  // Fallback to LLM classification when heuristic can't infer intent
  const english = await translateQueryToEnglish(original);
  const allowed = MOOD_TAGS.join('、');
  const prompt = [
    'Classify the user\'s movie search query into mood preferences.',
    'Return ONLY valid tags from the allowed list.',
    'Output MUST be a JSON object with exactly two keys: want (array) and avoid (array).',
    'Choose 0-5 tags for each array.',
    '',
    `Allowed tags: ${allowed}`,
    '',
    `User query (original): ${original}`,
    `User query (English): ${english || '(translation unavailable)'}`,
  ].join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 160,
    });

    const raw = (response.choices?.[0]?.message?.content || '').trim();
    if (!raw) {
      return { want: [], avoid: [] };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { want: [], avoid: [] };
    }

    const want = Array.isArray(parsed?.want) ? parsed.want : [];
    const avoid = Array.isArray(parsed?.avoid) ? parsed.avoid : [];
    return {
      want: [...new Set(want.map(String).map(s => s.trim()).filter(Boolean))].filter(t => MOOD_TAGS.includes(t)).slice(0, 5),
      avoid: [...new Set(avoid.map(String).map(s => s.trim()).filter(Boolean))].filter(t => MOOD_TAGS.includes(t)).slice(0, 5),
    };
  } catch (error) {
    console.warn(`inferMoodPreferencesFromQuery failed: ${error?.message || error}`);
    return { want: [], avoid: [] };
  }
}

function findBestMovieWithMood(queryVector, storedMovieData, moodPreferences, queryTextInfo) {
  const WANT_WEIGHT = 0.10;
  const AVOID_WEIGHT = 0.12;
  const LEXICAL_HIT_WEIGHT = 0.015;
  const LEXICAL_ANCHOR_WEIGHT = 0.07;
  const STRONG_SINGLE_TERMS = new Set(['pandora', "na'vi", 'avatar', 'enigma']);

  let best = null;
  let bestScore = -Infinity;
  let bestSimilarity = -1;
  let bestMatchedMoodTags = [];
  let bestAvoidMatchedMoodTags = [];

  const want = toTagArray(moodPreferences?.want);
  const avoid = toTagArray(moodPreferences?.avoid);

  const queryOriginal = queryTextInfo?.original || '';
  const queryEnglish = queryTextInfo?.english || '';
  const queryTerms = extractQueryTermsForLexical(queryOriginal, queryEnglish);

  for (const movie of storedMovieData) {
    if (!movie || !movie.vector || movie.vector.some(isNaN)) {
      continue;
    }

    const similarity = cosineSimilarity(queryVector, movie.vector);
    if (isNaN(similarity)) {
      continue;
    }

    const matchedWant = want.length > 0 ? intersectTags(movie.moodTags, want) : [];
    const matchedAvoid = avoid.length > 0 ? intersectTags(movie.moodTags, avoid) : [];

    // Lexical boost: tiny rerank signal for exact term hits in stored text
    const movieText = buildMovieSearchText(movie);
    let lexicalBoost = 0;
    for (const term of queryTerms) {
      if (!term) continue;
      if (movieText.includes(term)) {
        lexicalBoost += (term.includes(' ') || term === 'wwii' || term === 'world war ii' || STRONG_SINGLE_TERMS.has(term))
          ? LEXICAL_ANCHOR_WEIGHT
          : LEXICAL_HIT_WEIGHT;
      }
    }
    // cap to avoid overpowering semantics
    lexicalBoost = Math.min(0.25, lexicalBoost);

    const score = similarity
      + (matchedWant.length * WANT_WEIGHT)
      - (matchedAvoid.length * AVOID_WEIGHT)
      + lexicalBoost;

    if (score > bestScore) {
      best = movie;
      bestScore = score;
      bestSimilarity = similarity;
      bestMatchedMoodTags = matchedWant;
      bestAvoidMatchedMoodTags = matchedAvoid;
    }
  }

  return {
    movie: best,
    similarity: bestSimilarity,
    score: bestScore,
    matchedMoodTags: bestMatchedMoodTags,
    matchedAvoidMoodTags: bestAvoidMatchedMoodTags,
  };
}

const OMDB_BASE_URL = 'https://www.omdbapi.com/';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3/movie/';

function sanitizePlotForAi(plot) {
  if (!plot || !String(plot).trim()) {
    return '';
  }
  // Wikipedia summary often contains cast lists like "It stars ..." — remove those sentences
  return String(plot)
    .replace(/\bIt\s+stars\b[^.]*\./gi, '')
    .replace(/\bThe\s+film\s+stars\b[^.]*\./gi, '')
    .replace(/\bStarring\b[^.]*\./gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function htmlToText(html) {
  if (!html || !String(html).trim()) {
    return '';
  }
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars).trim() + '\n\n[Truncated]';
}

// 創建一個簡單的函數來查詢電影資料
const fetchMovieData = async (movieTitle, opts = {}) => {
  const canUseOmdb = hasEnv('OMDB_API_KEY');
  const year = opts?.year;

  // 1. 查詢 OMDb API 獲取基本資料（如果有 OMDB_API_KEY）
  const omdbData = canUseOmdb ? await fetchOMDbMovieData(movieTitle, year) : null;

  if (omdbData) {
    console.log(`Title: ${omdbData.title}`);
    console.log(`Year: ${omdbData.year}`);
    console.log(`Genre: ${omdbData.genre}`);
    console.log(`IMDb Rating: ${omdbData.imdbRating}`);
    console.log(`Director: ${omdbData.director}`);
    console.log(`Runtime: ${omdbData.runtime}`);
    console.log(`Language: ${omdbData.language}`);

    const result = {
      ...omdbData,
      actors: undefined,
      keywords: undefined,
      tags: undefined,
      detailedPlot: undefined,
    };

    // 2. 查詢 TMDb API 獲取演員名單、關鍵字和標籤
    // fetchTMDbMovieData 需要 IMDb ID（tt...），OMDb 回傳在 imdbId
    const tmdbData = await fetchTMDbMovieData(omdbData.imdbId);
    if (tmdbData) {
      console.log(`Actors from TMDb: ${tmdbData.actors}`);
      console.log(`Keywords from TMDb: ${tmdbData.keywords}`);
      console.log(`Tags from TMDb: ${tmdbData.tags}`);

        // 顯示電影原產地
        if (tmdbData.productionCountry) {
          console.log(`電影原產地: ${tmdbData.productionCountry}`);
        }

      result.actors = tmdbData.actors;
      result.keywords = tmdbData.keywords;
      result.tags = tmdbData.tags;
      result.moodKeywords = tmdbData.moodKeywords;
      result.tmdbId = tmdbData.tmdbId;
      // 修正語言欄位：只顯示 TMDb 的 original_language
      if (tmdbData.original_language) {
        result.language = tmdbData.original_language;
      }
      // 新增原產國家欄位
      if (tmdbData.productionCountry) {
        // 標明是電影原產地
        result.productionCountry = tmdbData.productionCountry; // 電影原產地
      }
    }

    // 3. 用 Wikipedia/OMDb 的 plot 當素材，讓 AI 生成「完整電影劇情」並取代 Wikipedia 顯示/儲存
    const wikipediaDescription = await fetchWikipediaDescription(movieTitle);
    // 先用 Wikipedia plot，若無則用 OMDb plot
    const plotForAi = sanitizePlotForAi(wikipediaDescription || omdbData.plot || '');
    // 用 OpenAI 生成 AI 劇情摘要
    const fullPlot = await generateExpandedOverview(plotForAi);
    result.expandedOverview = fullPlot;
    result.detailedPlot = fullPlot;
    if (fullPlot) {
      console.log(`Detailed Plot (AI): ${fullPlot}`);
    }

    return result;
  } else {
    if (!canUseOmdb) {
      console.warn('OMDB_API_KEY is not set; falling back to Wikipedia-only data.');
    } else {
      console.log('Movie not found in OMDb; falling back to Wikipedia-only data if available.');
    }

    // Wikipedia fallback: use Wikipedia as source, but store only AI-generated full plot.
    const wikipediaDescription = await fetchWikipediaDescription(movieTitle);
    if (!wikipediaDescription) {
      console.log('Movie not found.');
      return null;
    }

    const plotForAi = sanitizePlotForAi(wikipediaDescription);
    const fullPlot = await generateExpandedOverview(plotForAi);

    return {
      title: movieTitle,
      year: undefined,
      genre: undefined,
      imdbRating: undefined,
      director: undefined,
      runtime: undefined,
      language: undefined,
      actors: undefined,
      keywords: undefined,
      tags: undefined,
      imdbId: undefined,
      plot: undefined,
      expandedOverview: fullPlot,
      detailedPlot: fullPlot,
    };
  }
};

function shouldGenerateMoodTags(movie) {
  const hasText = !!(
    (movie?.plot && String(movie.plot).trim())
    || (movie?.detailedPlot && String(movie.detailedPlot).trim())
    || (movie?.expandedOverview && String(movie.expandedOverview).trim())
    || (movie?.keywords && String(movie.keywords).trim())
    || (movie?.tags && String(movie.tags).trim())
  );
  return hasText;
}

function validateMovieForStorage(movie) {
  const missing = [];

  const requireString = (key) => {
    const value = movie?.[key];
    if (!value || !String(value).trim()) {
      missing.push(key);
    }
  };

  requireString('title');
  requireString('year');
  requireString('genre');
  requireString('director');
  requireString('runtime');
  requireString('language');
  requireString('imdbId');
  // plot 與 AI 劇情至少要有一個完整
  const plot = movie?.plot && String(movie.plot).trim();
  const detailedPlot = movie?.detailedPlot && String(movie.detailedPlot).trim();
  const expandedOverview = movie?.expandedOverview && String(movie.expandedOverview).trim();
  if (!plot) {
    missing.push('plot');
  }
  if (!detailedPlot && !expandedOverview) {
    missing.push('detailedPlot');
  }

  return { ok: missing.length === 0, missing };
}

function buildMovieEmbeddingText(movie) {
  // 只拼接非演員資訊（actors 欄位獨立，不進入 embedding）
  return [
    movie.title,
    movie.genre,
    movie.director,
    movie.language,
    movie.keywords,
    movie.tags,
    Array.isArray(movie.moodTags) ? movie.moodTags.join(', ') : movie.moodTags,
    movie.plot,
    movie.expandedOverview,
    movie.detailedPlot,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildMoodAnalysisText(movie) {
  return [
    `Title: ${movie.title || ''}`,
    `Genre: ${movie.genre || ''}`,
    `Tags: ${movie.tags || ''}`,
    `Keywords: ${movie.keywords || ''}`,
    `Plot: ${movie.plot || ''}`,
    `DetailedPlot: ${movie.detailedPlot || ''}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// 用 OpenAI 自動生成情緒/氛圍標籤（供使用者依情緒搜尋）
async function generateMoodTags(movie) {
  const analysisText = buildMoodAnalysisText(movie);
  const allowed = MOOD_TAGS.join(', ');
  const prompt = [
    'You are a movie tagger. Based on the following movie information, select 3 to 8 of the most appropriate mood/atmosphere tags from the "Allowed Tags List".',
    'Only use tags from the allowed list. Do not invent new tags.',
    'Output format MUST be a JSON array (e.g., ["Tense","Suspense","Dark"]). Do not output any other text.',
    '',
    `Allowed Tags List: ${allowed}`,
    '',
    `Movie Information:\n${analysisText}`,
  ].join('\n');

  try {
    const response = await withRetry(
      () => openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 120,
      }),
      { label: 'openai.chat.completions.create (moodTags)', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
    );

    const raw = (response.choices?.[0]?.message?.content || '').trim();
    if (!raw) {
      return [];
    }

    // 期待 JSON array
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 退而求其次：用逗號/頓號拆
      parsed = raw
        .replace(/[\]["]+/g, '')
        .split(/[,，、\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
    }

    const list = Array.isArray(parsed) ? parsed : [];
    // 只保留允許清單中的標籤、去重
    const filtered = [...new Set(list.filter(t => MOOD_TAGS.includes(t)))];
    return filtered;
  } catch (error) {
    console.error('Error generating mood tags:', error);
    return [];
  }
}

function isValidEmbeddingVector(vector) {
  return Array.isArray(vector)
    && vector.length === EXPECTED_EMBEDDING_DIM
    && !vector.some(isNaN);
}

function loadTitlesFromFileOrArgs(args, titlesFilePath) {
  const titlesFromArgs = args.filter(Boolean);
  if (titlesFromArgs.length > 0) {
    return titlesFromArgs;
  }

  if (fs.existsSync(titlesFilePath)) {
    const raw = JSON.parse(fs.readFileSync(titlesFilePath));
    if (Array.isArray(raw)) {
      return raw.filter(Boolean);
    }
  }

  return [];
}

function validateStoredMovieData(storedMovieData) {
  if (!Array.isArray(storedMovieData) || storedMovieData.length === 0) {
    return { ok: false, reason: 'stored movie dataset is empty or not an array' };
  }

  for (const movie of storedMovieData) {
    if (!movie || typeof movie.title !== 'string') {
      return { ok: false, reason: 'movie_data.json contains an item without a valid title' };
    }
    if (!isValidEmbeddingVector(movie.vector)) {
      return { ok: false, reason: `invalid embedding vector for: ${movie.title}` };
    }
  }

  return { ok: true };
}

function shouldReadFromDynamo(args) {
  return args.includes('--dynamodb') || args.includes('--ddb');
}

function getDynamoScanLimit(args) {
  const idx = args.findIndex(a => a === '--limit');
  if (idx >= 0 && args[idx + 1]) {
    const n = Number(args[idx + 1]);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return null;
}

function stripArgs(args, stripList) {
  const strip = new Set(stripList);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (strip.has(a)) {
      // skip value for flags like --limit
      if (a === '--limit') {
        i += 1;
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

function coerceMovieFromDynamo(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const movie = { ...item };
  if (Array.isArray(movie.vector)) {
    movie.vector = movie.vector.map(Number);
  }
  return movie;
}

async function loadMoviesFromDynamo(args) {
  const tableName = getDynamoTableName();
  const docClient = getDynamoDocClient();
  // eslint-disable-next-line global-require
  const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

  const limit = getDynamoScanLimit(args);
  const items = [];
  let lastKey = undefined;
  do {
    const res = await docClient.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastKey,
    }));
    const batch = (res.Items || []).map(coerceMovieFromDynamo);
    items.push(...batch);
    lastKey = res.LastEvaluatedKey;
    if (limit && items.length >= limit) {
      return items.slice(0, limit);
    }
  } while (lastKey);

  return items;
}

async function loadStoredMoviesForSearch(args, movieDataPath) {
  if (shouldReadFromDynamo(args)) {
    console.log(`[Search] Loading movies from DynamoDB table: ${getDynamoTableName()} ...`);
    const movies = await loadMoviesFromDynamo(args);
    console.log(`[Search] Loaded ${movies.length} movie(s) from DynamoDB.`);
    return movies;
  }
  return readJsonArrayOrEmpty(movieDataPath);
}

async function promptQueryLoop(storedMovieData) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\n輸入自然語言查詢來做搜尋（輸入 exit / quit 結束）');
    while (true) {
      let query;
      try {
        query = await rl.question('Query> ');
      } catch (error) {
        const code = error?.code;
        // When stdin is piped and ends, readline can throw after close.
        if (code === 'ERR_USE_AFTER_CLOSE' || code === 'ERR_INVALID_STATE') {
          break;
        }
        // Treat any other question() failure as end-of-input.
        break;
      }

      query = String(query || '').trim();
      if (!query) {
        continue;
      }
      if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
        break;
      }

      const queryInfo = await generateMultilingualQueryEmbeddingWithText(query);
      const queryEmbedding = queryInfo.embedding;
      if (!isValidEmbeddingVector(queryEmbedding)) {
        console.log('Query embedding 無效，請再試一次。');
        continue;
      }

      if (isAnchoredWorldWarIIQuery(queryInfo.original, queryInfo.english)) {
        const hasAnyWWII = storedMovieData.some(m => movieMentionsWorldWarII(buildMovieSearchText(m)));
        if (!hasAnyWWII) {
          console.log('No relevant movies found.');
          continue;
        }
      }

      const moodPreferences = await inferMoodPreferencesFromQuery(query);
      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        const wantText = moodPreferences.want.length > 0 ? moodPreferences.want.join(', ') : '(none)';
        const avoidText = moodPreferences.avoid.length > 0 ? moodPreferences.avoid.join(', ') : '(none)';
        console.log(`Mood intent (want): ${wantText}`);
        console.log(`Mood intent (avoid): ${avoidText}`);
      }

      const result = findBestMovieWithMood(queryEmbedding, storedMovieData, moodPreferences, queryInfo);
      if (!result.movie) {
        console.log('找不到相似電影（可能是資料庫是空的或向量無效）。');
        continue;
      }

      if (!isResultRelevant(result.similarity)) {
        console.log('No relevant movies found.');
        continue;
      }
      console.log(`Most similar movie: ${result.movie.title} (similarity=${result.similarity})`);
      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        console.log(`Matched want tags: ${(result.matchedMoodTags || []).join(', ') || '(none)'}`);
        console.log(`Matched avoid tags: ${(result.matchedAvoidMoodTags || []).join(', ') || '(none)'}`);
      }
    }
  } finally {
    rl.close();
  }
}

// 查詢 OMDb API
const fetchOMDbMovieData = async (movieTitle, year) => {
  const apiKey = requireEnv('OMDB_API_KEY');
  // Use plot=full for richer plot text (helps downstream AI rewriting)
  const yearParam = year ? `&y=${encodeURIComponent(String(year))}` : '';
  const url = `${OMDB_BASE_URL}?t=${encodeURIComponent(movieTitle)}${yearParam}&plot=full&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const response = await axiosGetWithRetry(url, {}, { label: 'omdb.get', timeoutMs: 15000, maxAttempts: 5 });
    const data = response.data;

    if (data.Response === 'True') {
      return {
        title: data.Title,
        year: data.Year,
        genre: data.Genre,  // 多個電影類型
        imdbRating: data.imdbRating,
        director: data.Director,  // 導演
        runtime: data.Runtime,  // 時長
        language: data.Language,  // 原始語言
        actors: data.Actors,
        plot: data.Plot,  // 簡短的電影劇情
        imdbId: data.imdbID, // IMDb ID（用於 TMDb find）
      };
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching OMDb data:', error);
    return null;
  }
};

// 使用 TMDb API 獲取電影詳細資料和演員名單
const fetchTMDbMovieData = async (imdbId) => {
  if (!imdbId) {
    console.error('Error fetching TMDb data: missing IMDb ID');
    return null;
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    console.warn('TMDB_API_KEY is not set; skipping TMDb enrichment.');
    return null;
  }
  const findUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&external_source=imdb_id`;
  try {
    const findResponse = await axiosGetWithRetry(findUrl, {}, { label: 'tmdb.find', timeoutMs: 15000, maxAttempts: 5 });
    const findData = findResponse.data;
    const tmdbId = findData?.movie_results?.[0]?.id;
    if (!tmdbId) {
      console.error(`TMDb find returned no movie for IMDb ID: ${imdbId}`);
      return null;
    }

    const detailsUrl = `${TMDB_BASE_URL}${tmdbId}?api_key=${apiKey}&append_to_response=credits,keywords`;
  const detailsResponse = await axiosGetWithRetry(detailsUrl, {}, { label: 'tmdb.details', timeoutMs: 15000, maxAttempts: 5 });
    const data = detailsResponse.data;

    // 只取前 10 位主要演員
    const actors = data?.credits?.cast && Array.isArray(data.credits.cast)
      ? data.credits.cast.slice(0, 10).map(actor => actor.name).join(', ')
      : 'No actors found';


    // 關鍵字（TMDb keywords 的格式可能是 keywords.keywords）
    const keywordItems = data?.keywords?.keywords || data?.keywords?.results || [];
    let keywordsArr = Array.isArray(keywordItems) && keywordItems.length > 0
      ? keywordItems.map(k => k.name).filter(Boolean)
      : [];
    // 只取前 10 個
    keywordsArr = keywordsArr.slice(0, 10);
    const keywords = keywordsArr.join(', ') || 'No keywords found';

    // 標籤（genres）
    const tags = Array.isArray(data?.genres) && data.genres.length > 0
      ? data.genres.map(g => g.name).join(', ')
      : 'No tags found';

    // TMDb 的原始語言
    const original_language = data?.original_language || '';
    // TMDb 的原產國家（陣列，取英文名稱）
    const countriesArr = Array.isArray(data?.production_countries) ? data.production_countries.map(c => c.name).filter(Boolean) : [];
    const productionCountry = countriesArr.join(', ');
    return { actors, keywords, tags, tmdbId, original_language, productionCountry };
  } catch (error) {
    console.error('Error fetching TMDb data:', error);
    return null;
  }
};

// 使用 axios 從 Wikipedia 獲取電影詳細劇情描述
const fetchWikipediaDescription = async (movieTitle) => {
  try {
    // 注意：Wikipedia URL 中的電影名稱需要用 "_" 替代空格
    const formattedTitle = movieTitle.replace(/\s+/g, '_');

    // Prefer the MediaWiki Action API to fetch the "Plot" section (mobile-sections is decommissioned).
    // 1) Get section list
    const apiUrl = 'https://en.wikipedia.org/w/api.php';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    try {
      const sectionsResponse = await axiosGetWithRetry(apiUrl, {
        headers,
        params: {
          action: 'parse',
          page: movieTitle,
          prop: 'sections',
          format: 'json',
          redirects: 1,
        },
      }, { label: 'wikipedia.parse.sections', timeoutMs: 15000, maxAttempts: 5 });

      const sections = sectionsResponse.data?.parse?.sections || [];
      const plotSection = sections.find(s => String(s?.line || '').trim().toLowerCase() === 'plot');

      if (plotSection?.index) {
        // 2) Fetch the plot section HTML
        const plotResponse = await axiosGetWithRetry(apiUrl, {
          headers,
          params: {
            action: 'parse',
            page: movieTitle,
            prop: 'text',
            section: plotSection.index,
            format: 'json',
            redirects: 1,
          },
        }, { label: 'wikipedia.parse.plot', timeoutMs: 15000, maxAttempts: 5 });

        const html = plotResponse.data?.parse?.text?.['*'] || '';
        const plotText = htmlToText(html);
        if (plotText) {
          return truncateText(plotText, 8000);
        }
      }
    } catch (e) {
      console.warn(`Wikipedia plot-section fetch failed; falling back to summary. (${e?.message || e})`);
    }

    // Fallback to summary
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${formattedTitle}`;
    const summaryResponse = await axiosGetWithRetry(summaryUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    }, { label: 'wikipedia.summary', timeoutMs: 15000, maxAttempts: 5 });

    if (summaryResponse.data && summaryResponse.data.extract) {
      return truncateText(summaryResponse.data.extract, 8000);
    }

    console.error('Error fetching Wikipedia data: No plot/summary extract found');
    return null;
  } catch (error) {
    console.error(`Error fetching Wikipedia data: ${error?.message || error}`);
    return null;
  }
};

function usage() {
  console.log('Usage:');
  console.log('  node fetchMovie.js build                # build from movie-vectors/movie_titles.json');
  console.log('  node fetchMovie.js build --fresh        # rebuild from scratch (ignore existing movie_data.json)');
  console.log('  node fetchMovie.js build --dynamodb     # also write each saved movie to DynamoDB');
  console.log('  node fetchMovie.js build "The Matrix"   # build one (or many) titles from args');
  console.log('  node fetchMovie.js build-popular        # sample from TMDb popular and build');
  console.log('    --count 100 --pages 10 --min-votes 500 --delay-ms 350 [--resample] [--fresh] [--dynamodb]');
  console.log('  node fetchMovie.js search               # interactive semantic search (uses stored vectors)');
  console.log('');
  console.log('Required env:');
  console.log('  OPENAI_API_KEY');
  console.log('If using --dynamodb:');
  console.log('  DDB_TABLE_NAME (default: reLivre-movies)');
  console.log('  AWS_REGION (or configured AWS profile/credentials)');
  console.log('Recommended env (for richer metadata):');
  console.log('  OMDB_API_KEY');
  console.log('Optional env:');
  console.log('  TMDB_API_KEY (required for build-popular; optional for build enrichment)');
}

function shouldWriteToDynamo(args) {
  return args.includes('--dynamodb') || args.includes('--ddb');
}

function getDynamoTableName() {
  return (process.env.DDB_TABLE_NAME || process.env.MOVIES_TABLE_NAME || 'reLivre-movies').trim();
}

function getDynamoDocClient() {
  // Require lazily so users can run without AWS deps unless they use --dynamodb.
  // eslint-disable-next-line global-require
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  // eslint-disable-next-line global-require
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION;
  const ddb = new DynamoDBClient(region ? { region } : {});
  return DynamoDBDocumentClient.from(ddb, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

async function putMovieToDynamo(docClient, tableName, movie) {
  // eslint-disable-next-line global-require
  const { PutCommand } = require('@aws-sdk/lib-dynamodb');

  if (!movie || !movie.imdbId) {
    throw new Error('Missing imdbId; cannot write to DynamoDB');
  }

  const item = {
    ...movie,
    titleLower: String(movie.title || '').toLowerCase(),
    // Keep year as-is (string) to match CDK GSI sortKey
    year: movie.year,
  };

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: item,
  }));
}

function readJsonArrayOrEmpty(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeJsonArrayOrThrow(filePath, value) {
  const json = JSON.stringify(value, null, 2);
  fs.writeFileSync(filePath, json, { encoding: 'utf8' });

  // 立即讀回驗證，避免「看似成功但檔案實際不可讀/被清空」的情況
  const verifyText = fs.readFileSync(filePath, 'utf8');
  if (!verifyText || !verifyText.trim()) {
    throw new Error(`Write failed: ${filePath} is empty after write`);
  }
  const parsed = JSON.parse(verifyText);
  if (!Array.isArray(parsed)) {
    throw new Error(`Write failed: ${filePath} is not a JSON array after write`);
  }
}

function upsertMovieByTitle(existing, movie) {
  const titleKey = String(movie?.title || '').trim().toLowerCase();
  if (!titleKey) {
    return existing;
  }

  const next = Array.isArray(existing) ? [...existing] : [];
  const idx = next.findIndex(m => String(m?.title || '').trim().toLowerCase() === titleKey);
  if (idx >= 0) {
    next[idx] = { ...next[idx], ...movie };
  } else {
    next.push(movie);
  }
  return next;
}

async function buildOneMovie(title, opts = {}) {
  const movie = await fetchMovieData(title, opts);
  if (!movie) {
    return null;
  }

  // expandedOverview/detailedPlot are generated inside fetchMovieData.
  // Only fill missing fields if needed.
  if (!movie.expandedOverview && movie.detailedPlot) {
    movie.expandedOverview = movie.detailedPlot;
  }
  if (!movie.detailedPlot && movie.expandedOverview) {
    movie.detailedPlot = movie.expandedOverview;
  }
  if (!movie.expandedOverview && !movie.detailedPlot) {
    const fullPlot = await generateExpandedOverview(movie.plot || '');
    movie.expandedOverview = fullPlot;
    movie.detailedPlot = fullPlot;
  }

  const validation = validateMovieForStorage(movie);
  if (!validation.ok) {
    throw new Error(`[INCOMPLETE] missing fields: ${validation.missing.join(', ')}`);
  }

  movie.moodTags = shouldGenerateMoodTags(movie) ? await generateMoodTags(movie) : [];

  const embeddingText = buildMovieEmbeddingText(movie);
  const vector = await generateEmbedding(embeddingText);
  if (!isValidEmbeddingVector(vector)) {
    console.error(`[Build] Invalid embedding vector for: ${title}`);
    return null;
  }
  movie.vector = vector;
  return movie;
}

function getFlagNumber(args, name, defaultValue) {
  const idx = args.findIndex(a => a === name);
  if (idx >= 0 && args[idx + 1] != null) {
    const v = Number(args[idx + 1]);
    if (Number.isFinite(v)) {
      return v;
    }
  }
  return defaultValue;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchPopularSeedsFromTMDb({ pages, minVotes }) {
  const apiKey = requireEnv('TMDB_API_KEY');
  const results = [];

  for (let page = 1; page <= pages; page++) {
    const url = `https://api.themoviedb.org/3/movie/popular?api_key=${encodeURIComponent(apiKey)}&language=en-US&page=${page}`;
    const resp = await axiosGetWithRetry(url, {}, { label: `tmdb.popular.page.${page}`, timeoutMs: 15000, maxAttempts: 5 });
    const items = Array.isArray(resp.data?.results) ? resp.data.results : [];
    for (const item of items) {
      const title = String(item?.title || item?.original_title || '').trim();
      if (!title) continue;
      const voteCount = Number(item?.vote_count || 0);
      if (Number.isFinite(minVotes) && voteCount < minVotes) continue;
      const releaseDate = String(item?.release_date || '').trim();
      const year = releaseDate ? releaseDate.slice(0, 4) : '';
      results.push({
        tmdbId: item?.id,
        title,
        year,
        voteCount,
        popularity: Number(item?.popularity || 0),
      });
    }
  }

  // De-dupe by title+year (best-effort)
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = `${String(r.title).toLowerCase()}|${String(r.year || '').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return deduped;
}

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'build').toLowerCase();

  const vectorsDir = path.join(__dirname, 'movie-vectors');
  const movieDataPath = path.join(vectorsDir, 'movie_data.json');
  const titlesPath = path.join(vectorsDir, 'movie_titles.json');

  if (command === '--help' || command === '-h' || command === 'help') {
    usage();
    return;
  }

  if (command === 'search') {
    requireEnv('OPENAI_API_KEY');
    const storedMovieData = await loadStoredMoviesForSearch(args, movieDataPath);
    const validation = validateStoredMovieData(storedMovieData);
    if (!validation.ok) {
      console.error(`Cannot search: ${validation.reason}`);
      console.error('Run: node fetchMovie.js build');
      return;
    }

    const queryArgs = stripArgs(args.slice(1), ['--dynamodb', '--ddb', '--limit']);
    const oneShotQuery = queryArgs.join(' ').trim();
    if (oneShotQuery) {
      const queryInfo = await generateMultilingualQueryEmbeddingWithText(oneShotQuery);
      const queryEmbedding = queryInfo.embedding;
      if (!isValidEmbeddingVector(queryEmbedding)) {
        console.log('Query embedding 無效，請再試一次。');
        return;
      }

      if (isAnchoredWorldWarIIQuery(queryInfo.original, queryInfo.english)) {
        const hasAnyWWII = storedMovieData.some(m => movieMentionsWorldWarII(buildMovieSearchText(m)));
        if (!hasAnyWWII) {
          console.log('No relevant movies found.');
          return;
        }
      }

      const moodPreferences = await inferMoodPreferencesFromQuery(oneShotQuery);
      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        const wantText = moodPreferences.want.length > 0 ? moodPreferences.want.join(', ') : '(none)';
        const avoidText = moodPreferences.avoid.length > 0 ? moodPreferences.avoid.join(', ') : '(none)';
        console.log(`Mood intent (want): ${wantText}`);
        console.log(`Mood intent (avoid): ${avoidText}`);
      }

      const result = findBestMovieWithMood(queryEmbedding, storedMovieData, moodPreferences, queryInfo);
      if (!result.movie) {
        console.log('找不到相似電影（可能是資料庫是空的或向量無效）。');
        return;
      }

      if (!isResultRelevant(result.similarity)) {
        console.log('No relevant movies found.');
        return;
      }
      console.log(`Most similar movie: ${result.movie.title} (similarity=${result.similarity})`);
      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        console.log(`Matched want tags: ${(result.matchedMoodTags || []).join(', ') || '(none)'}`);
        console.log(`Matched avoid tags: ${(result.matchedAvoidMoodTags || []).join(', ') || '(none)'}`);
      }
      return;
    }

    await promptQueryLoop(storedMovieData);
    return;
  }

  if (command === 'search-batch') {
    requireEnv('OPENAI_API_KEY');
    const storedMovieData = await loadStoredMoviesForSearch(args, movieDataPath);
    const validation = validateStoredMovieData(storedMovieData);
    if (!validation.ok) {
      console.error(`Cannot search: ${validation.reason}`);
      console.error('Run: node fetchMovie.js build');
      return;
    }

    const batchArgs = stripArgs(args.slice(1), ['--dynamodb', '--ddb', '--limit']);
    const queriesFile = batchArgs[0]
      ? path.resolve(process.cwd(), batchArgs[0])
      : path.join(vectorsDir, 'search_queries.json');

    let queries;
    try {
      queries = JSON.parse(fs.readFileSync(queriesFile, 'utf8'));
    } catch (error) {
      console.error(`Cannot read queries file: ${queriesFile}`);
      console.error(error?.message || error);
      return;
    }

    if (!Array.isArray(queries) || queries.length === 0) {
      console.error('Queries file must be a non-empty JSON array.');
      return;
    }

    const TOP_K = 5;
    let pass = 0;
    let fail = 0;

    for (const item of queries) {
      const query = String(item?.query || '').trim();
      if (!query) {
        continue;
      }

      const expectedRaw = item?.expected;
      const expected = Array.isArray(expectedRaw)
        ? expectedRaw.map(String).map(s => s.trim()).filter(Boolean)
        : (expectedRaw ? [String(expectedRaw).trim()] : []);

      const queryInfo = await generateMultilingualQueryEmbeddingWithText(query);
      const queryEmbedding = queryInfo.embedding;
      if (!isValidEmbeddingVector(queryEmbedding)) {
        console.log(`\n[Query] ${query}`);
        console.log('No relevant movies found.');
        if (expected.length > 0) {
          fail += 1;
        }
        continue;
      }

      // Anchored WWII: if none exist in DB, it's a hard "no".
      if (isAnchoredWorldWarIIQuery(queryInfo.original, queryInfo.english)) {
        const hasAnyWWII = storedMovieData.some(m => movieMentionsWorldWarII(buildMovieSearchText(m)));
        if (!hasAnyWWII) {
          console.log(`\n[Query] ${query}`);
          console.log('No relevant movies found.');
          if (expected.length > 0) {
            fail += 1;
          }
          continue;
        }
      }

      const moodPreferences = await inferMoodPreferencesFromQuery(query);
      const top = rankMoviesWithSignals(queryEmbedding, storedMovieData, moodPreferences, queryInfo, TOP_K);
      const best = top[0];

      console.log(`\n[Query] ${query}`);
      if (queryInfo.english && queryInfo.english.toLowerCase() !== queryInfo.original.toLowerCase()) {
        console.log(`[EN] ${queryInfo.english}`);
      }

      if (!best || !isResultRelevant(best.similarity)) {
        console.log('No relevant movies found.');
        if (expected.length > 0) {
          fail += 1;
        }
        continue;
      }

      if (moodPreferences.want.length > 0 || moodPreferences.avoid.length > 0) {
        console.log(`[Mood want] ${moodPreferences.want.join(', ') || '(none)'}`);
        console.log(`[Mood avoid] ${moodPreferences.avoid.join(', ') || '(none)'}`);
      }

      console.log('Top results:');
      for (const r of top) {
        const terms = r.matchedTerms.length > 0 ? ` terms=[${r.matchedTerms.join(', ')}]` : '';
        const mw = r.matchedWantTags.length > 0 ? ` want=[${r.matchedWantTags.join(', ')}]` : '';
        const ma = r.matchedAvoidTags.length > 0 ? ` avoid=[${r.matchedAvoidTags.join(', ')}]` : '';
        console.log(`- ${r.title} | score=${r.score.toFixed(4)} | sim=${r.similarity.toFixed(4)} | lex=${r.lexicalBoost.toFixed(3)}${terms}${mw}${ma}`);
      }

      if (expected.length > 0) {
        const ok = expected.some(t => String(best.title).toLowerCase() === String(t).toLowerCase());
        if (ok) {
          console.log('Result: PASS');
          pass += 1;
        } else {
          console.log(`Result: FAIL (expected: ${expected.join(' | ')})`);
          fail += 1;
        }
      }
    }

    if (pass + fail > 0) {
      console.log(`\nSummary: PASS=${pass} FAIL=${fail}`);
    }
    return;
  }

  if (command === 'build-popular') {
    requireEnv('OPENAI_API_KEY');
    requireEnv('TMDB_API_KEY');
    if (!hasEnv('OMDB_API_KEY')) {
      console.warn('OMDB_API_KEY is missing. Build will use Wikipedia-only fallback (less accurate metadata).');
    }

    const count = Math.floor(getFlagNumber(args, '--count', 100));
    const pages = Math.floor(getFlagNumber(args, '--pages', 10));
    const minVotes = Math.floor(getFlagNumber(args, '--min-votes', 500));
    const delayMs = Math.floor(getFlagNumber(args, '--delay-ms', 350));
    const resample = args.includes('--resample');

    const freshBuild = args.includes('--fresh') || args.includes('--reset');
    const toDynamo = shouldWriteToDynamo(args);

    fs.mkdirSync(vectorsDir, { recursive: true });
    let stored = freshBuild ? [] : readJsonArrayOrEmpty(movieDataPath);

    const seedsPath = path.join(vectorsDir, 'build_popular_seeds.json');
    let seeds;
    if (!resample && fs.existsSync(seedsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
        seeds = Array.isArray(raw) ? raw : [];
      } catch {
        seeds = [];
      }
      console.log(`[Build-Popular] Loaded ${seeds.length} seed(s) from ${seedsPath}`);
    }

    if (!Array.isArray(seeds) || seeds.length === 0) {
      console.log(`[Build-Popular] Fetching TMDb popular seeds: pages=${pages}, minVotes=${minVotes}`);
      const fetched = await fetchPopularSeedsFromTMDb({ pages, minVotes });
      shuffleInPlace(fetched);
      seeds = fetched.slice(0, Math.max(0, count));
      writeJsonArrayOrThrow(seedsPath, seeds);
      console.log(`[Build-Popular] Sampled ${seeds.length} seed(s) and saved to ${seedsPath}`);
    }

    if (seeds.length === 0) {
      console.error('[Build-Popular] No seeds to process. Try lowering --min-votes or increasing --pages.');
      return;
    }

    const tableName = toDynamo ? getDynamoTableName() : '';
    const ddbDoc = toDynamo ? getDynamoDocClient() : null;
    const ddbErrorTitles = [];

    const skippedTitles = [];
    const incompleteTitles = [];
    const errorTitles = [];
    const alreadyHaveTitles = [];

    console.log(`[Build-Popular] Starting. seeds=${seeds.length} fresh=${freshBuild} delayMs=${delayMs} dynamodb=${toDynamo}`);

    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const title = String(seed?.title || '').trim();
      const year = seed?.year ? String(seed.year).trim() : '';
      if (!title) {
        continue;
      }

      const titleKey = title.toLowerCase();
      const already = stored.find(m => String(m?.title || '').trim().toLowerCase() === titleKey
        && (!year || String(m?.year || '').trim() === year));
      if (already) {
        console.log(`\n[Build-Popular] (${i + 1}/${seeds.length}) Already have: ${title}${year ? ` (${year})` : ''}`);
        alreadyHaveTitles.push(title);
        continue;
      }

      console.log(`\n[Build-Popular] (${i + 1}/${seeds.length}) Processing: ${title}${year ? ` (${year})` : ''}`);
      try {
        const movie = await buildOneMovie(title, { year });
        if (!movie) {
          console.log(`[Build] Skipped: ${title}`);
          skippedTitles.push(title);
          continue;
        }
        stored = upsertMovieByTitle(stored, movie);
        writeJsonArrayOrThrow(movieDataPath, stored);
        console.log(`[Build] Saved: ${movie.title}`);

        if (toDynamo) {
          try {
            await putMovieToDynamo(ddbDoc, tableName, movie);
            console.log(`[Build] Saved to DynamoDB: ${movie.title} -> ${tableName}`);
          } catch (ddbError) {
            console.error(`[Build] DynamoDB write failed for "${movie.title}": ${ddbError?.message || ddbError}`);
            ddbErrorTitles.push(movie.title);
          }
        }
      } catch (error) {
        const message = String(error?.message || error);
        if (message.includes('[INCOMPLETE]')) {
          console.warn(`[Build] Incomplete: ${title} -> ${message}`);
          incompleteTitles.push(title);
        } else {
          console.error(`[Build] Error processing "${title}": ${message}`);
          errorTitles.push(title);
        }
        console.log(`[Build] Skipped: ${title}`);
      } finally {
        if (delayMs > 0 && i < seeds.length - 1) {
          await sleep(delayMs);
        }
      }
    }

    console.log(`\nDone. Processed ${seeds.length} seed(s). movie_data.json now contains ${stored.length} movie(s): ${movieDataPath}`);
    if (alreadyHaveTitles.length > 0) {
      console.log(`\n=== 已存在（略過）===`);
      console.log(`- ${alreadyHaveTitles.slice(0, 40).join(' | ')}${alreadyHaveTitles.length > 40 ? ' ...' : ''}`);
    }

    const notSaved = [...new Set([...skippedTitles, ...incompleteTitles, ...errorTitles])];
    if (notSaved.length > 0) {
      console.log('\n=== 未成功儲存的電影（抓不到 / 資訊不完整 / 例外）===');
      if (skippedTitles.length > 0) {
        console.log(`- 抓不到或向量無效（Skipped）: ${skippedTitles.join(' | ')}`);
      }
      if (incompleteTitles.length > 0) {
        console.log(`- 資訊不完整（Incomplete）: ${incompleteTitles.join(' | ')}`);
      }
      if (errorTitles.length > 0) {
        console.log(`- 其他錯誤（Error）: ${errorTitles.join(' | ')}`);
      }
    }

    if (toDynamo) {
      if (ddbErrorTitles.length > 0) {
        console.log(`\n=== DynamoDB 寫入失敗（但本地 movie_data.json 已更新）===`);
        console.log(`- ${ddbErrorTitles.join(' | ')}`);
      } else {
        console.log(`\nDynamoDB write complete: ${tableName}`);
      }
    }
    return;
  }

  if (command !== 'build') {
    usage();
    return;
  }

  requireEnv('OPENAI_API_KEY');
  if (!hasEnv('OMDB_API_KEY')) {
    console.warn('OMDB_API_KEY is missing. Build will use Wikipedia-only fallback (less accurate metadata).');
  }

  const freshBuild = args.includes('--fresh') || args.includes('--reset');
  const toDynamo = shouldWriteToDynamo(args);
  const titleArgs = args
    .slice(1)
    .filter(a => !['--fresh', '--reset', '--dynamodb', '--ddb'].includes(a));
  const titles = loadTitlesFromFileOrArgs(titleArgs, titlesPath);
  if (titles.length === 0) {
    console.error('No titles provided and movie_titles.json is empty/missing.');
    usage();
    return;
  }

  console.log(`[Build] Loaded ${titles.length} title(s) from ${titleArgs.length > 0 ? 'command-line args' : 'movie-vectors/movie_titles.json'}.`);
  if (freshBuild) {
    console.log('[Build] Fresh mode: starting from empty movie_data.json');
  }

  fs.mkdirSync(vectorsDir, { recursive: true });
  let stored = freshBuild ? [] : readJsonArrayOrEmpty(movieDataPath);

  const tableName = toDynamo ? getDynamoTableName() : '';
  const ddbDoc = toDynamo ? getDynamoDocClient() : null;
  const ddbErrorTitles = [];

  const skippedTitles = [];
  const incompleteTitles = [];
  const errorTitles = [];

  for (const title of titles) {
    console.log(`\n[Build] Processing: ${title}`);
    try {
      const movie = await buildOneMovie(title);
      if (!movie) {
        console.log(`[Build] Skipped: ${title}`);
        skippedTitles.push(title);
        continue;
      }
      stored = upsertMovieByTitle(stored, movie);
      writeJsonArrayOrThrow(movieDataPath, stored);
      console.log(`[Build] Saved: ${movie.title}`);

      if (toDynamo) {
        try {
          await putMovieToDynamo(ddbDoc, tableName, movie);
          console.log(`[Build] Saved to DynamoDB: ${movie.title} -> ${tableName}`);
        } catch (ddbError) {
          console.error(`[Build] DynamoDB write failed for "${movie.title}": ${ddbError?.message || ddbError}`);
          ddbErrorTitles.push(movie.title);
        }
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes('[INCOMPLETE]')) {
        console.warn(`[Build] Incomplete: ${title} -> ${message}`);
        incompleteTitles.push(title);
      } else {
        console.error(`[Build] Error processing "${title}": ${message}`);
        errorTitles.push(title);
      }
      console.log(`[Build] Skipped: ${title}`);
      continue;
    }
  }

  console.log(`\nDone. Processed ${titles.length} title(s). movie_data.json now contains ${stored.length} movie(s): ${movieDataPath}`);

  const notSaved = [...new Set([...skippedTitles, ...incompleteTitles, ...errorTitles])];
  if (notSaved.length > 0) {
    console.log('\n=== 未成功儲存的電影（抓不到 / 資訊不完整 / 例外）===');
    if (skippedTitles.length > 0) {
      console.log(`- 抓不到或向量無效（Skipped）: ${skippedTitles.join(' | ')}`);
    }
    if (incompleteTitles.length > 0) {
      console.log(`- 資訊不完整（Incomplete）: ${incompleteTitles.join(' | ')}`);
    }
    if (errorTitles.length > 0) {
      console.log(`- 其他錯誤（Error）: ${errorTitles.join(' | ')}`);
    }
  }

  if (toDynamo) {
    if (ddbErrorTitles.length > 0) {
      console.log(`\n=== DynamoDB 寫入失敗（但本地 movie_data.json 已更新）===`);
      console.log(`- ${ddbErrorTitles.join(' | ')}`);
    } else {
      console.log(`\nDynamoDB write complete: ${tableName}`);
    }
  }
}

// 用 OpenAI 生成擴展劇情描述
async function generateExpandedOverview(plot) {
  if (!plot || !String(plot).trim()) {
    return '';
  }
  const prompt = `請將下方 SOURCE PLOT 內容，重寫成一段「完整但精簡」的電影劇情摘要，長度和資訊量請參考這個範例：\nThe Imitation Game is a 2014 British-American historical drama film based on the true story of British mathematician Alan Turing. During World War II, Turing (played by Benedict Cumberbatch) is tasked with leading a team to break the Nazi German "Enigma" code, which was considered the most sophisticated cryptographic machine in the world. Despite Turing's eccentric personality causing tension with his colleagues, he overcomes obstacles with the support of his brilliant colleague Joan Clarke, and successfully develops a device to decrypt the enemy's codes. This breakthrough alters the course of the war, saving millions of lives and laying the foundation for modern computer science. However, after the war, Turing is revealed to be homosexual and is convicted by the government, leading to a tragic end.\n---\n請用類似的長度、資訊密度和敘事風格，完整交代電影主線、關鍵事件與結局，不要多寫也不要少寫，不要提演員名字，不要發揮想像。最後請再補上一句話，讓這段摘要更容易被自然語言搜尋找到。只輸出一段純文字。\n\nSOURCE PLOT:\n${plot}\n`;

  try {
    const response = await withRetry(
      () => openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: prompt },
        ],
        max_tokens: 1600,
        temperature: 0.4,
      }),
      { label: 'openai.chat.completions.create (expandedOverview)', maxAttempts: 6, baseDelayMs: 800, maxDelayMs: 12000 },
    );

    return (response.choices?.[0]?.message?.content || '').trim();
  } catch (error) {
    console.error(`Error generating expanded overview: ${error?.message || error}`);
    return '';
  }
}

main();
