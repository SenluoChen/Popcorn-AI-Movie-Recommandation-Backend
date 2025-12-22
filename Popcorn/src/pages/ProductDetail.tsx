// src/pages/ProductDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";

import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import {
  tmdbGetMovieDetails,
  tmdbGetWatchProviders,
  tmdbImage,
  type WatchProvider,
} from "../utils/tmdb";
import { getDefaultRegion } from "../utils/recommendMovies";

type MediaTrailer = { name?: string | null; site?: string | null; type?: string | null; key?: string | null; url: string };
type MediaItem = { tmdbId: number; imdbId?: string | null; title?: string | null; posterUrl?: string | null; trailers?: MediaTrailer[] };

let media1000Promise: Promise<Map<number, MediaItem>> | null = null;

async function loadMedia1000ByTmdbId(): Promise<Map<number, MediaItem>> {
  if (media1000Promise) return media1000Promise;
  media1000Promise = (async () => {
    try {
      const resp = await fetch('/media_1000.json', { cache: 'no-cache' });
      if (!resp.ok) return new Map();
      const data = await resp.json().catch(() => ({}));
      const byTmdbId = data?.byTmdbId && typeof data.byTmdbId === 'object' ? data.byTmdbId : {};
      const map = new Map<number, MediaItem>();
      for (const [k, v] of Object.entries(byTmdbId)) {
        const tmdbId = Number(k);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        map.set(tmdbId, v as MediaItem);
      }
      return map;
    } catch {
      return new Map();
    }
  })();
  return media1000Promise;
}

function tryGetYouTubeEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || '').trim();
  if (!raw) return '';

  // Support: youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>
  const m1 = raw.match(/youtu\.be\/(.+?)(\?|$)/i);
  const m2 = raw.match(/[?&]v=([^&]+)/i);
  const m3 = raw.match(/youtube\.com\/embed\/([^?&/]+)/i);
  const id = (m1?.[1] || m2?.[1] || m3?.[1] || '').trim();
  if (!id) return '';
  if (!/^[a-zA-Z0-9_-]{6,}$/.test(id)) return '';
  return `https://www.youtube.com/embed/${id}`;
}

function tryGetVimeoEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || '').trim();
  if (!raw) return '';

  // Support: vimeo.com/<id>, player.vimeo.com/video/<id>
  const m1 = raw.match(/vimeo\.com\/(\d+)(\?|$)/i);
  const m2 = raw.match(/player\.vimeo\.com\/video\/(\d+)(\?|$)/i);
  const id = (m1?.[1] || m2?.[1] || '').trim();
  if (!id) return '';
  if (!/^\d{6,}$/.test(id)) return '';
  return `https://player.vimeo.com/video/${id}`;
}

function tryGetEmbedUrl(url: string | null | undefined): string {
  return tryGetYouTubeEmbedUrl(url) || tryGetVimeoEmbedUrl(url) || '';
}

export default function ProductDetail() {
  const { id } = useParams();
  const movieId = Number(id);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [detail, setDetail] = useState<
    | {
        id: number;
        title: string;
        tagline?: string;
        overview?: string;
        poster_path: string | null;
        release_date?: string;
        runtime?: number;
        vote_average?: number;
        genres?: { id: number; name: string }[];
      }
    | null
  >(null);

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [selectedTrailerIndex, setSelectedTrailerIndex] = useState(0);

  const [flatrate, setFlatrate] = useState<WatchProvider[]>([]);
  const [rent, setRent] = useState<WatchProvider[]>([]);
  const [buy, setBuy] = useState<WatchProvider[]>([]);

  const region = useMemo(() => getDefaultRegion(), []);

  useEffect(() => {
    if (!movieId || Number.isNaN(movieId)) {
      setError("Invalid movie id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    (async () => {
      try {
        const d = await tmdbGetMovieDetails(movieId, { language: "zh-TW" });
        setDetail(d);

        // Load  local prebuilt media (poster + trailers) for this tmdbId
        try {
          const map = await loadMedia1000ByTmdbId();
          const m = map.get(movieId) || null;
          setMedia(m);
          setSelectedTrailerIndex(0);
        } catch {
          setMedia(null);
        }

        const wp = await tmdbGetWatchProviders(movieId);
        const regionBlock = wp.results?.[region] ?? wp.results?.US;
        setFlatrate(regionBlock?.flatrate ?? []);
        setRent(regionBlock?.rent ?? []);
        setBuy(regionBlock?.buy ?? []);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load movie");
      } finally {
        setLoading(false);
      }
    })();
  }, [movieId, region]);

  const trailerCandidates: MediaTrailer[] = Array.isArray(media?.trailers) ? (media!.trailers as MediaTrailer[]) : [];
  const selectedTrailer = trailerCandidates[selectedTrailerIndex] || trailerCandidates[0] || null;
  const embedUrl = tryGetEmbedUrl(selectedTrailer?.url);

  return (
    <>
      <Navbar query={query} setQuery={setQuery} onRecommend={() => {}} />

      <Box sx={{ px: 4, py: 3, backgroundColor: 'var(--page-bg)' }}>
        <Button onClick={() => navigate(-1)} sx={{ mb: 2 }}>
          返回
        </Button>

        {loading ? (
          <Typography>載入中…</Typography>
        ) : error ? (
          <Typography color="error">{error}</Typography>
        ) : !detail ? (
          <Typography>找不到此電影</Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '360px 1fr' }, gap: 4, position: 'relative' }}>
            <Box sx={{ width: { xs: '100%', md: 360 } }}>
              <Box
                sx={{
                  width: '100%',
                  height: 520,
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundColor: 'var(--surface-muted)',
                  border: '1px solid var(--border-1)',
                }}
              >
                {media?.posterUrl ? (
                  <img
                    src={media.posterUrl}
                    alt={detail.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : detail.poster_path ? (
                  <img
                    src={tmdbImage(detail.poster_path, 'w500')}
                    alt={detail.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : null}
              </Box>
            </Box>

            <Box sx={{ position: 'relative', minWidth: 280 }}>
              <Box sx={{ width: '100%', borderRadius: 2, overflow: 'hidden' }}>
                {embedUrl ? (
                  <Box sx={{ width: '100%', height: 520, borderRadius: 2, overflow: 'hidden', backgroundColor: '#000', border: '1px solid var(--border-1)' }}>
                    <Box sx={{ position: 'relative', paddingTop: '56.25%' }}>
                      <iframe
                        src={embedUrl}
                        title={`${detail.title} trailer`}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ width: '100%', height: 520, borderRadius: 2, overflow: 'hidden', backgroundColor: 'var(--surface-muted)', border: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography color="text.secondary">沒有可嵌入的 trailer</Typography>
                  </Box>
                )}
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography variant="h4" sx={{ fontWeight: 800 }}>
                  {detail.title}
                </Typography>

                {detail.tagline ? (
                  <Typography sx={{ mt: 1 }} color="text.secondary">
                    {detail.tagline}
                  </Typography>
                ) : null}

                <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
                  {(detail.genres ?? []).map((g) => (
                    <Chip key={g.id} label={g.name} size="small" />
                  ))}
                </Stack>

                <Typography sx={{ mt: 2 }}>
                  {detail.release_date ? `上映：${detail.release_date}` : ''}
                  {detail.runtime ? ` · 片長：${detail.runtime} 分` : ''}
                  {detail.vote_average ? ` · ★ ${Number(detail.vote_average).toFixed(1)}` : ''}
                </Typography>

                <Divider sx={{ my: 2 }} />

                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{detail.overview}</Typography>
              </Box>

              {/*
 * Platform suggestion block — bottom right
 */}
              <Box
                sx={{
                  position: { xs: 'static', md: 'absolute' },
                  right: { md: 0 },
                  bottom: { md: 0 },
                  width: { xs: '100%', md: 320 },
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border-1)',
                  borderRadius: 2,
                  p: 2,
                  mt: { xs: 2, md: 0 },
                }}
              >
                <Typography sx={{ fontWeight: 800, mb: 1 }}>平台建議</Typography>
                <Typography sx={{ mb: 1, color: 'text.secondary' }}>下列平台可觀看（稍後會附上連結）</Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  {flatrate.map((p) => (
                    <Chip key={p.provider_id} label={p.provider_name} />
                  ))}
                  {rent.map((p) => (
                    <Chip key={`rent-${p.provider_id}`} label={`${p.provider_name} (租)` } />
                  ))}
                  {buy.map((p) => (
                    <Chip key={`buy-${p.provider_id}`} label={`${p.provider_name} (買)` } />
                  ))}
                  {!flatrate.length && !rent.length && !buy.length ? (
                    <Typography color="text.secondary">此地區暫無平台資訊。</Typography>
                  ) : null}
                </Stack>
              </Box>
            </Box>
          </Box>
        )}
      </Box>

      <Footer />
    </>
  );
}
