import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import { getDefaultRegion } from "../utils/recommendMovies";
import type { MovieRecommendation } from "../utils/recommendMovies";
import {
  tmdbGetMovieCredits,
  tmdbGetMovieDetails,
  tmdbGetWatchProviders,
  tmdbImage,
  type TmdbMovieCredits,
  type WatchProvider,
  type WatchProvidersResponse,
} from "../utils/tmdb";
import { MEDIA_HEIGHTS, MEDIA_GRID_COLUMNS, DETAILS_GRID_COLUMNS } from "../config/ui";
import CHIP_SX from "../config/uiStyles";

type Media1000Trailer = { url?: string; name?: string; site?: string; type?: string; key?: string };

type Media1000Item = {
  tmdbId: number;
  imdbId?: string | null;
  title?: string | null;
  year?: string | null;
  posterUrl?: string | null;
  trailers?: Media1000Trailer[];
};

let media1000ByTmdbIdPromise: Promise<Map<number, Media1000Item>> | null = null;

async function loadMedia1000ByTmdbId(): Promise<Map<number, Media1000Item>> {
  if (media1000ByTmdbIdPromise) return media1000ByTmdbIdPromise;
  media1000ByTmdbIdPromise = (async () => {
    try {
      const resp = await fetch("/media_1000.json", { cache: "no-cache" });
      if (!resp.ok) return new Map();
      const data = await resp.json().catch(() => ({}));
      const raw = data?.byTmdbId && typeof data.byTmdbId === "object" ? data.byTmdbId : {};
      const map = new Map<number, Media1000Item>();
      for (const [k, v] of Object.entries(raw)) {
        const tmdbId = Number(k);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        map.set(tmdbId, v as Media1000Item);
      }
      return map;
    } catch {
      return new Map();
    }
  })();
  return media1000ByTmdbIdPromise;
}

function tryGetYouTubeEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();

    // youtu.be/<id>
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      if (/^[a-zA-Z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
      return "";
    }

    // youtube.com/watch?v=<id>
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v") || "";
      if (/^[a-zA-Z0-9_-]{6,}$/.test(v)) return `https://www.youtube.com/embed/${v}`;

      // youtube.com/embed/<id>
      const parts = u.pathname.split("/").filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === "embed");
      if (embedIdx >= 0) {
        const id = parts[embedIdx + 1] || "";
        if (/^[a-zA-Z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
      }
    }

    return "";
  } catch {
    return "";
  }
}

function tryGetVimeoEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();

    // vimeo.com/<id>
    if (host.endsWith("vimeo.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const id = (host.startsWith("player.") ? parts[1] : parts[0]) || "";
      if (/^\d{6,}$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }

    return "";
  } catch {
    return "";
  }
}

function tryGetEmbedUrl(url: string | null | undefined): string {
  return tryGetYouTubeEmbedUrl(url) || tryGetVimeoEmbedUrl(url) || "";
}

export default function MovieDetail() {
  const navigate = useNavigate();
  const { id } = useParams();

  const movieId = useMemo(() => Number(id), [id]);
  const region = useMemo(() => getDefaultRegion(), []);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [detail, setDetail] = useState<Awaited<ReturnType<typeof tmdbGetMovieDetails>> | null>(null);
  const [media, setMedia] = useState<Media1000Item | null>(null);

  const [credits, setCredits] = useState<TmdbMovieCredits | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProvidersResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!Number.isFinite(movieId) || movieId <= 0) {
      setError("Invalid movie id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    (async () => {
      try {
        const [d, c, wp, mediaMap] = await Promise.all([
          tmdbGetMovieDetails(movieId, { language: "en-US" }),
          tmdbGetMovieCredits(movieId, { language: "en-US" }).catch(() => null),
          tmdbGetWatchProviders(movieId).catch(() => null),
          loadMedia1000ByTmdbId().catch(() => new Map<number, Media1000Item>()),
        ]);

        if (cancelled) return;

        setDetail(d);
        setCredits(c);
        setWatchProviders(wp);
        setMedia(mediaMap.get(movieId) || null);
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message || "Failed to load movie"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [movieId]);

  const year = useMemo(() => {
    const s = String(detail?.release_date || "").trim();
    return s ? s.slice(0, 4) : "";
  }, [detail?.release_date]);

  const directors = useMemo(() => {
    const names = (credits?.crew || [])
      .filter((m) => String(m?.job || "").toLowerCase() === "director")
      .map((m) => String(m?.name || "").trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [credits]);

  const topCast = useMemo(() => {
    const sorted = [...(credits?.cast || [])].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    return sorted.slice(0, 12);
  }, [credits]);

  const regionBlock = useMemo(() => {
    const results = watchProviders?.results || {};
    return results[region] || results.US || results.GB || null;
  }, [watchProviders, region]);

  const flatrate = Array.isArray(regionBlock?.flatrate) ? regionBlock!.flatrate! : [];
  const rent = Array.isArray(regionBlock?.rent) ? regionBlock!.rent! : [];
  const buy = Array.isArray(regionBlock?.buy) ? regionBlock!.buy! : [];

  const pageBg = "var(--brand-900)";
  const surface = "var(--surface)";
  const border = "var(--border-1)";
  const muted = "var(--surface-muted)";

  const posterSrc = useMemo(() => {
    if (media?.posterUrl) return media.posterUrl;
    if (detail?.poster_path) return tmdbImage(detail.poster_path, "w500");
    return "";
  }, [media?.posterUrl, detail?.poster_path]);

  const trailerEmbedUrl = useMemo(() => {
    const trailers = Array.isArray(media?.trailers) ? media!.trailers! : [];
    for (const t of trailers) {
      const embed = tryGetEmbedUrl(t?.url);
      if (embed) return embed;
    }
    return "";
  }, [media]);

  return (
    <>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults: MovieRecommendation[], usedQuery?: string) => {
          const q = String(usedQuery || query || "").trim();
          navigate(`/search?q=${encodeURIComponent(q)}`, { state: { results: nextResults, q } });
        }}
      />

      <div style={{ backgroundColor: pageBg, minHeight: "calc(100vh - 200px)" }}>
                <Container style={{ paddingTop: 18, paddingBottom: 64 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <IconButton
              onClick={() => navigate(-1)}
              aria-label="go back"
              size="large"
              sx={{
                border: `1px solid ${border}`,
                backgroundColor: surface,
                borderRadius: 999,
                color: "var(--text-invert)",
                width: 46,
                height: 46,
                boxShadow: "var(--shadow-1)",
                "& svg": { fontSize: 30 },
              }}
            >
              <ArrowBackRoundedIcon />
            </IconButton>
          </Box>

          {loading ? (
            <Typography sx={{ color: muted }}>Loading</Typography>
          ) : error ? (
            <Typography sx={{ color: "var(--danger-500)" }}>{error}</Typography>
          ) : !detail ? (
            <Typography sx={{ color: muted }}>Movie not found.</Typography>
          ) : (
            <Stack spacing={3}>
              <Box sx={{ display: "grid", gridTemplateColumns: MEDIA_GRID_COLUMNS as any, gap: 3, alignItems: "stretch" }}>
                <Box
                  sx={{
                    width: "100%",
                    height: { xs: MEDIA_HEIGHTS.xs, sm: MEDIA_HEIGHTS.sm, md: MEDIA_HEIGHTS.md },
                    borderRadius: 2,
                    overflow: "hidden",
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                  }}
                >
                  {posterSrc ? (
                    <img src={posterSrc} alt={detail.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                      <Typography sx={{ color: muted, fontWeight: 700 }}>Poster not available</Typography>
                    </Box>
                  )}
                </Box>

                <Box
                  sx={{
                    width: "100%",
                    height: { xs: MEDIA_HEIGHTS.xs, sm: MEDIA_HEIGHTS.sm, md: MEDIA_HEIGHTS.md },
                    borderRadius: 2,
                    overflow: "hidden",
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                  }}
                >
                  {trailerEmbedUrl ? (
                    <iframe
                      title="Trailer"
                      src={trailerEmbedUrl}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ width: "100%", height: "100%", border: 0 }}
                    />
                  ) : (
                    <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                      <Typography sx={{ color: muted, fontWeight: 700 }}>Trailer not available</Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              <Box sx={{ display: "grid", gridTemplateColumns: DETAILS_GRID_COLUMNS as any, gap: 3 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h4" sx={{ color: "var(--text-invert)", fontWeight: 900, letterSpacing: -0.3 }}>
                    {detail.title}{year ? ` (${year})` : ""}
                  </Typography>
                  {detail.tagline ? (
                    <Typography sx={{ mt: 1, color: muted, fontStyle: "italic" }}>{detail.tagline}</Typography>
                  ) : null}

                  <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }}>
                    {typeof detail.vote_average === "number" ? (
                      <Chip label={`${detail.vote_average.toFixed(1)} `} sx={{ ...CHIP_SX, backgroundColor: surface, color: "var(--text-invert)" }} />
                    ) : null}
                    {typeof detail.runtime === "number" ? (
                      <Chip label={`${detail.runtime} min`} sx={{ ...CHIP_SX, backgroundColor: surface, color: "var(--text-invert)" }} />
                    ) : null}
                    {directors.length ? (
                      <Chip
                        label={`Director: ${directors.slice(0, 2).join(", ")}`}
                        sx={{ ...CHIP_SX, backgroundColor: surface, color: "var(--text-invert)" }}
                      />
                    ) : null}
                  </Stack>

                  {Array.isArray(detail.genres) && detail.genres.length ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }}>
                      {detail.genres.slice(0, 10).map((g) => (
                        <Chip key={g.id} label={g.name} sx={{ ...CHIP_SX, backgroundColor: surface, color: "var(--text-invert)" }} />
                      ))}
                    </Stack>
                  ) : null}

                  <Divider sx={{ my: 2, borderColor: border }} />

                  <Typography sx={{ color: "var(--text-invert)", fontWeight: 800, mb: 1, fontSize: { xs: 15, md: 18 } }}>Overview</Typography>
                  <Typography sx={{ color: muted, lineHeight: 1.7 }}>
                    {String(detail.overview || "").trim() ? detail.overview : "(Plot not available)"}
                  </Typography>

                  {topCast.length ? (
                    <>
                      <Divider sx={{ my: 2, borderColor: border }} />
                      <Typography sx={{ color: "var(--text-invert)", fontWeight: 800, mb: 1, fontSize: { xs: 15, md: 18 } }}>Cast</Typography>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                        {topCast.map((m) => (
                          <Chip
                            key={m.id}
                            label={m.character ? `${m.name}  ${m.character}` : m.name}
                            sx={{ ...CHIP_SX, backgroundColor: surface, color: "var(--text-invert)" }}
                          />
                        ))}
                      </Stack>
                    </>
                  ) : null}
                </Box>

                <Box sx={{ width: { xs: "100%", md: 360 }, backgroundColor: surface, border: `1px solid ${border}`, borderRadius: 2, p: 2, mt: { md: 2 } }}>
                  <Typography sx={{ color: "var(--text-invert)", fontWeight: 900, mb: 1 }}>Where to watch</Typography>

                  {/* Removed external 'Open provider page' link per UX request */}

                  {flatrate.length || rent.length || buy.length ? (
                    <Stack spacing={2}>
                      {flatrate.length ? (
                        <Box>
                          <Typography sx={{ color: muted, fontWeight: 800, mb: 1 }}>Stream</Typography>
                          <ProviderRow providers={flatrate} />
                        </Box>
                      ) : null}
                      {rent.length ? (
                        <Box>
                          <Typography sx={{ color: muted, fontWeight: 800, mb: 1 }}>Rent</Typography>
                          <ProviderRow providers={rent} />
                        </Box>
                      ) : null}
                      {buy.length ? (
                        <Box>
                          <Typography sx={{ color: muted, fontWeight: 800, mb: 1 }}>Buy</Typography>
                          <ProviderRow providers={buy} />
                        </Box>
                      ) : null}
                    </Stack>
                  ) : (
                    <Typography sx={{ color: muted, lineHeight: 1.6 }}>No watch providers found for region: {region}</Typography>
                  )}
                </Box>
              </Box>
            </Stack>
          )}
        </Container>
      </div>

      <Footer />
    </>
  );
}

function ProviderRow({ providers }: { providers: WatchProvider[] }) {
  const surface = "var(--surface)";
  const border = "var(--border-1)";
  // Render as uniform square icon tiles for consistent alignment
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {providers.slice(0, 18).map((p) => {
        const logo = p.logo_path ? tmdbImage(p.logo_path, "w185") : "";
        return (
          <div
            key={p.provider_id}
            title={p.provider_name}
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              background: surface,
              border: `1px solid ${border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {logo ? (
              <img src={logo} alt={p.provider_name} style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} />
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-invert)", textAlign: "center", padding: 4 }}>{p.provider_name}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Container({ children, style = {} }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ width: "100%", maxWidth: 1360, margin: "0 auto", padding: "0 20px", ...style }}>{children}</div>
  );
}
