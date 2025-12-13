import { tmdbDiscoverMovies, tmdbSearchMovies, type TmdbMovie, tmdbGetGenres } from "./tmdb";

export type MovieRecommendation = {
  id: number;
  title: string;
  overview?: string;
  poster_path: string | null;
  release_date?: string;
  vote_average?: number;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function guessCountryFromLocale(locale?: string): string {
  const l = locale || (typeof navigator !== "undefined" ? navigator.language : "");
  const m = l.match(/-([a-zA-Z]{2})/);
  return (m?.[1] || "US").toUpperCase();
}

function extractYearRange(q: string): { gte?: string; lte?: string } {
  // examples: 2019, 2010s, 90年代, 1990年代
  const year = q.match(/(19\d{2}|20\d{2})/);
  if (year) {
    const y = Number(year[1]);
    return { gte: `${y}-01-01`, lte: `${y}-12-31` };
  }

  const decade = q.match(/(19\d0|20\d0)s/);
  if (decade) {
    const y = Number(decade[1]);
    return { gte: `${y}-01-01`, lte: `${y + 9}-12-31` };
  }

  const decadeZh = q.match(/(\d{2})\s*年代/);
  if (decadeZh) {
    const d = Number(decadeZh[1]);
    const y = d >= 30 ? 1900 + d : 2000 + d;
    return { gte: `${y}-01-01`, lte: `${y + 9}-12-31` };
  }

  return {};
}

function extractOriginalLanguage(q: string): string | undefined {
  const map: Array<[RegExp, string]> = [
    [/\b(japanese|jp|日本|日文)\b/i, "ja"],
    [/\b(korean|kr|韓國|韓文)\b/i, "ko"],
    [/\b(english|en|英文)\b/i, "en"],
    [/\b(french|fr|法文)\b/i, "fr"],
    [/\b(spanish|es|西班牙文)\b/i, "es"],
    [/\b(german|de|德文)\b/i, "de"],
  ];
  for (const [re, code] of map) {
    if (re.test(q)) return code;
  }
  return undefined;
}

function keywordGenres(q: string): string[] {
  const rules: Array<[RegExp, string[]]> = [
    [/\b(恐怖|horror|鬼)\b/i, ["Horror"]],
    [/\b(搞笑|喜劇|comedy|好笑)\b/i, ["Comedy"]],
    [/\b(愛情|romance|戀愛)\b/i, ["Romance"]],
    [/\b(科幻|sci[- ]?fi|science fiction)\b/i, ["Science Fiction"]],
    [/\b(動作|action)\b/i, ["Action"]],
    [/\b(懸疑|mystery|推理)\b/i, ["Mystery", "Thriller"]],
    [/\b(驚悚|thriller)\b/i, ["Thriller"]],
    [/\b(動畫|animation|anime|アニメ)\b/i, ["Animation"]],
    [/\b(家庭|family|親子)\b/i, ["Family"]],
    [/\b(犯罪|crime|黑幫)\b/i, ["Crime"]],
    [/\b(戰爭|war)\b/i, ["War"]],
    [/\b(紀錄|documentary)\b/i, ["Documentary"]],
    [/\b(音樂|music)\b/i, ["Music"]],
    [/\b(冒險|adventure)\b/i, ["Adventure"]],
    [/\b(奇幻|fantasy)\b/i, ["Fantasy"]],
  ];

  const names = new Set<string>();
  for (const [re, genreNames] of rules) {
    if (re.test(q)) genreNames.forEach((g) => names.add(g));
  }
  return Array.from(names);
}

async function mapGenreNamesToIds(genreNames: string[], language?: string): Promise<string | undefined> {
  if (!genreNames.length) return undefined;
  const genres = await tmdbGetGenres({ language });
  const byName = new Map(genres.map((g) => [normalize(g.name), g.id] as const));
  const ids = genreNames
    .map((n) => byName.get(normalize(n)))
    .filter((v): v is number => typeof v === "number");
  return ids.length ? ids.join(",") : undefined;
}

function looksLikeTitleSearch(q: string) {
  // If user uses quotes or explicitly says '片名/電影名/title'
  return /["“”]/.test(q) || /\b(title|movie name|片名|電影名)\b/i.test(q);
}

function asRecommendations(movies: TmdbMovie[]): MovieRecommendation[] {
  return movies.map((m) => ({
    id: m.id,
    title: m.title,
    overview: m.overview,
    poster_path: m.poster_path,
    release_date: m.release_date,
    vote_average: m.vote_average,
  }));
}

export async function recommendMovies(nlQuery: string, opts?: { language?: string; region?: string; limit?: number }) {
  const q = nlQuery.trim();
  if (!q) return [] as MovieRecommendation[];

  const language = opts?.language ?? "zh-TW";

  // 1) If it looks like a title query, prioritize /search
  if (looksLikeTitleSearch(q) || q.length <= 18) {
    const sr = await tmdbSearchMovies(q.replace(/["“”]/g, ""), { language, page: 1, include_adult: false });
    return asRecommendations(sr.results.slice(0, opts?.limit ?? 12));
  }

  // 2) Structured discover using simple keyword extraction
  const yr = extractYearRange(q);
  const lang = extractOriginalLanguage(q);
  const genreNames = keywordGenres(q);
  const withGenres = await mapGenreNamesToIds(genreNames, language);

  const dr = await tmdbDiscoverMovies({
    language,
    page: 1,
    sort_by: "popularity.desc",
    with_genres: withGenres,
    primary_release_date_gte: yr.gte,
    primary_release_date_lte: yr.lte,
    with_original_language: lang,
    vote_count_gte: 50,
    include_adult: false,
  });

  const recs = dr.results;

  // 3) If discover comes back too thin, fallback to /search
  if (recs.length < 4) {
    const sr = await tmdbSearchMovies(q, { language, page: 1, include_adult: false });
    return asRecommendations(sr.results.slice(0, opts?.limit ?? 12));
  }

  return asRecommendations(recs.slice(0, opts?.limit ?? 12));
}

export function getDefaultRegion(): string {
  return guessCountryFromLocale(typeof navigator !== "undefined" ? navigator.language : undefined);
}
