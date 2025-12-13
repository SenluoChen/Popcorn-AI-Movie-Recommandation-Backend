// Ce script permet de construire une base de données vectorielle de films à partir de différentes sources (OMDb, TMDb, Wikipedia) et d'effectuer des recherches sémantiques ou par ambiance/mood.
// Il utilise l'API OpenAI pour générer des embeddings et enrichir les descriptions de films.
// Usage principal :
//   node fetchMovie.js build                # construit la base à partir de movie_titles.json
//   node fetchMovie.js search               # recherche interactive par similarité
// Les clés API nécessaires doivent être définies dans un fichier .env
require('dotenv').config(); // 載入 .env 文件
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

const EMBEDDING_MODEL = 'text-embedding-ada-002';
// text-embedding-ada-002 的向量維度固定是 1536
const EXPECTED_EMBEDDING_DIM = 1536;

// 情緒/氛圍標籤（用於情緒搜尋）
const MOOD_TAGS = [
  '溫馨', '感人', '緊張', '黑暗', '幽默', '勵志', '浪漫', '恐怖', '刺激', '悲傷',
  '療癒', '正能量', '壓抑', '歡樂', '冒險', '史詩', '懸疑', '驚悚', '科幻', '奇幻',
  '動作', '犯罪', '戰爭', '家庭', '青春', '成長',
];

// 生成嵌入（將文本轉換為向量）
async function generateEmbedding(text) {
  requireEnv('OPENAI_API_KEY');
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  const embedding = response.data[0].embedding;

  // 檢查查詢向量是否有效
  if (!embedding || embedding.some(isNaN)) {
    console.error('Generated query embedding contains invalid values');
    return [];  // 返回空向量，避免後續錯誤
  }

  return embedding;
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

// 查詢並返回最相似的電影
function findMostSimilarMovie(queryVector, storedMovieData) {
  let bestMatch = null;
  let highestSimilarity = -1;

  storedMovieData.forEach(movie => {
    // 檢查電影向量是否有效
    if (!movie.vector || movie.vector.some(isNaN)) {
      console.error(`Invalid vector data for movie: ${movie.title}`);
      return;  // 跳過無效的電影
    }

    const similarity = cosineSimilarity(queryVector, movie.vector);

    // 如果相似度是 NaN，則跳過這一輪
    if (isNaN(similarity)) {
      console.log(`Skipping movie ${movie.title} due to invalid similarity`);
      return;
    }

    console.log(`Similarity with ${movie.title}: ${similarity}`);
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      bestMatch = movie;
    }
  });
  return {
    movie: bestMatch,
    similarity: highestSimilarity,
  };
}

const OMDB_BASE_URL = 'https://www.omdbapi.com/';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3/movie/';

// 創建一個簡單的函數來查詢電影資料
const fetchMovieData = async (movieTitle) => {
  // 1. 查詢 OMDb API 獲取基本資料
  const omdbData = await fetchOMDbMovieData(movieTitle);

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
    const tmdbData = await fetchTMDbMovieData(omdbData.tmdbId);
    if (tmdbData) {
      console.log(`Actors from TMDb: ${tmdbData.actors}`);
      console.log(`Keywords from TMDb: ${tmdbData.keywords}`);
      console.log(`Tags from TMDb: ${tmdbData.tags}`);

      result.actors = tmdbData.actors;
      result.keywords = tmdbData.keywords;
      result.tags = tmdbData.tags;
    }

    // 3. 查詢 Wikipedia 獲取詳細劇情描述
    const wikipediaDescription = await fetchWikipediaDescription(movieTitle);
    if (wikipediaDescription) {
      console.log(`Detailed Plot from Wikipedia: ${wikipediaDescription}`);

      result.detailedPlot = wikipediaDescription;
    }

    return result;
  } else {
    console.log('Movie not found.');
    return null;
  }
};

function buildMovieEmbeddingText(movie) {
  // 盡量把可用的文字資訊拼接起來
  return [
    movie.title,
    movie.genre,
    movie.director,
    movie.language,
    movie.actors,
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
  const allowed = MOOD_TAGS.join('、');
  const prompt = [
    '你是一個電影標註員。請根據以下電影資訊，從「允許的標籤清單」中挑選 3~8 個最符合的情緒/氛圍標籤。',
    '只允許使用清單中的標籤，不要自創新標籤。',
    '輸出格式必須是 JSON array（例如：["緊張","懸疑","黑暗"]），不要輸出其他文字。',
    '',
    `允許的標籤清單：${allowed}`,
    '',
    `電影資訊：\n${analysisText}`,
  ].join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 120,
    });

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
    return { ok: false, reason: 'movie_data.json is empty or not an array' };
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

async function promptQueryLoop(storedMovieData) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\n輸入自然語言查詢來做搜尋（輸入 exit / quit 結束）');
    while (true) {
      const query = (await rl.question('Query> ')).trim();
      if (!query) {
        continue;
      }
      if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
        break;
      }

      const queryEmbedding = await generateEmbedding(query);
      if (!isValidEmbeddingVector(queryEmbedding)) {
        console.log('Query embedding 無效，請再試一次。');
        continue;
      }

      const result = findMostSimilarMovie(queryEmbedding, storedMovieData);
      if (!result.movie) {
        console.log('找不到相似電影（可能是資料庫是空的或向量無效）。');
        continue;
      }
      console.log(`Most similar movie: ${result.movie.title} (similarity=${result.similarity})`);
    }
  } finally {
    rl.close();
  }
}

// 查詢 OMDb API
const fetchOMDbMovieData = async (movieTitle) => {
  const apiKey = requireEnv('OMDB_API_KEY');
  const url = `${OMDB_BASE_URL}?t=${encodeURIComponent(movieTitle)}&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const response = await axios.get(url);
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
    const findResponse = await axios.get(findUrl);
    const findData = findResponse.data;
    const tmdbId = findData?.movie_results?.[0]?.id;
    if (!tmdbId) {
      console.error(`TMDb find returned no movie for IMDb ID: ${imdbId}`);
      return null;
    }

    const detailsUrl = `${TMDB_BASE_URL}${tmdbId}?api_key=${apiKey}&append_to_response=credits,keywords`;
    const detailsResponse = await axios.get(detailsUrl);
    const data = detailsResponse.data;

    // 演員
    const actors = data?.credits?.cast
      ? data.credits.cast.map(actor => actor.name).join(', ')
      : 'No actors found';

    // 關鍵字（TMDb keywords 的格式可能是 keywords.keywords）
    const keywordItems = data?.keywords?.keywords || data?.keywords?.results || [];
    const keywords = Array.isArray(keywordItems) && keywordItems.length > 0
      ? keywordItems.map(k => k.name).join(', ')
      : 'No keywords found';

    // 標籤（genres）
    const tags = Array.isArray(data?.genres) && data.genres.length > 0
      ? data.genres.map(g => g.name).join(', ')
      : 'No tags found';

    return { actors, keywords, tags, tmdbId };
  } catch (error) {
    console.error('Error fetching TMDb data:', error);
    return null;
  }
};

// 使用 axios 從 Wikipedia 獲取電影詳細劇情描述
const fetchWikipediaDescription = async (movieTitle) => {
  try {
    // 注意：Wikipedia URL 中的電影名稱需要用 "_" 替代空格
    const formattedTitle = movieTitle.replace(/\s+/g, '_');  // 格式化電影名稱

    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${formattedTitle}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // 確保 Wikipedia 返回的資料是有效的
    if (response.data && response.data.extract) {
      return response.data.extract; // 返回電影簡短描述
    } else {
      console.error('Error fetching Wikipedia data: No extract found');
      return null;
    }
  } catch (error) {
    console.error('Error fetching Wikipedia data:', error);
    return null;
  }
};

function usage() {
  console.log('Usage:');
  console.log('  node fetchMovie.js build                # build from movie-vectors/movie_titles.json');
  console.log('  node fetchMovie.js build "The Matrix"   # build one (or many) titles from args');
  console.log('  node fetchMovie.js search               # interactive semantic search (uses stored vectors)');
  console.log('');
  console.log('Required env:');
  console.log('  OPENAI_API_KEY, OMDB_API_KEY');
  console.log('Optional env:');
  console.log('  TMDB_API_KEY');
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

async function buildOneMovie(title) {
  const movie = await fetchMovieData(title);
  if (!movie) {
    return null;
  }

  movie.expandedOverview = await generateExpandedOverview(movie.plot || '');
  movie.moodTags = await generateMoodTags(movie);

  const embeddingText = buildMovieEmbeddingText(movie);
  const vector = await generateEmbedding(embeddingText);
  if (!isValidEmbeddingVector(vector)) {
    console.error(`[Build] Invalid embedding vector for: ${title}`);
    return null;
  }
  movie.vector = vector;
  return movie;
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
    const storedMovieData = readJsonArrayOrEmpty(movieDataPath);
    const validation = validateStoredMovieData(storedMovieData);
    if (!validation.ok) {
      console.error(`Cannot search: ${validation.reason}`);
      console.error('Run: node fetchMovie.js build');
      return;
    }
    await promptQueryLoop(storedMovieData);
    return;
  }

  if (command !== 'build') {
    usage();
    return;
  }

  requireEnv('OPENAI_API_KEY');
  requireEnv('OMDB_API_KEY');

  const titles = loadTitlesFromFileOrArgs(args.slice(1), titlesPath);
  if (titles.length === 0) {
    console.error('No titles provided and movie_titles.json is empty/missing.');
    usage();
    return;
  }

  fs.mkdirSync(vectorsDir, { recursive: true });
  let stored = readJsonArrayOrEmpty(movieDataPath);

  for (const title of titles) {
    console.log(`\n[Build] Processing: ${title}`);
    const movie = await buildOneMovie(title);
    if (!movie) {
      console.log(`[Build] Skipped: ${title}`);
      continue;
    }
    stored = upsertMovieByTitle(stored, movie);
    fs.writeFileSync(movieDataPath, JSON.stringify(stored, null, 2));
    console.log(`[Build] Saved: ${movie.title}`);
  }

  console.log(`\nDone. Wrote ${stored.length} movies to: ${movieDataPath}`);
}

// 用 OpenAI 生成擴展劇情描述
async function generateExpandedOverview(plot) {
  if (!plot || !String(plot).trim()) {
    return '';
  }
  const prompt = `\nExpand the following movie plot into a detailed and comprehensive story description. Include all key events and characters:\n${plot}\n`;

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'user', content: prompt },
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  return (response.choices?.[0]?.message?.content || '').trim();
}

main();
