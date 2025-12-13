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

  const [providersLink, setProvidersLink] = useState<string>("");
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

        const wp = await tmdbGetWatchProviders(movieId);
        const regionBlock = wp.results?.[region] ?? wp.results?.US;
        setProvidersLink(regionBlock?.link ?? "");
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

  return (
    <>
      <Navbar query={query} setQuery={setQuery} onRecommend={() => {}} />

      <Box sx={{ px: 4, py: 3 }}>
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
          <Box sx={{ display: "flex", gap: 4, flexWrap: { xs: "wrap", md: "nowrap" } }}>
            <Box sx={{ width: { xs: "100%", md: 360 } }}>
              <Box
                sx={{
                  width: "100%",
                  height: 520,
                  borderRadius: 2,
                  overflow: "hidden",
                  backgroundColor: "#f2f2f2",
                }}
              >
                {detail.poster_path ? (
                  <img
                    src={tmdbImage(detail.poster_path, "w500")}
                    alt={detail.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : null}
              </Box>
            </Box>

            <Box sx={{ flex: 1, minWidth: 280 }}>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                {detail.title}
              </Typography>

              {detail.tagline ? (
                <Typography sx={{ mt: 1 }} color="text.secondary">
                  {detail.tagline}
                </Typography>
              ) : null}

              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }}>
                {(detail.genres ?? []).map((g) => (
                  <Chip key={g.id} label={g.name} size="small" />
                ))}
              </Stack>

              <Typography sx={{ mt: 2 }}>
                {detail.release_date ? `上映：${detail.release_date}` : ""}
                {detail.runtime ? ` · 片長：${detail.runtime} 分` : ""}
                {detail.vote_average ? ` · ★ ${Number(detail.vote_average).toFixed(1)}` : ""}
              </Typography>

              <Divider sx={{ my: 2 }} />
              <Typography sx={{ whiteSpace: "pre-wrap" }}>{detail.overview}</Typography>

              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                可觀看平台（{region}）
              </Typography>

              {providersLink ? (
                <Button
                  variant="outlined"
                  onClick={() => window.open(providersLink, "_blank", "noopener,noreferrer")}
                  sx={{ mb: 2 }}
                >
                  在 TMDb 查看平台連結
                </Button>
              ) : null}

              <ProvidersSection title="串流" providers={flatrate} />
              <ProvidersSection title="租借" providers={rent} />
              <ProvidersSection title="購買" providers={buy} />

              {!flatrate.length && !rent.length && !buy.length ? (
                <Typography color="text.secondary">
                  這個地區目前 TMDb 沒提供平台資訊（可能是區域限制或資料缺失）。
                </Typography>
              ) : null}
            </Box>
          </Box>
        )}
      </Box>

      <Footer />
    </>
  );
}

function ProvidersSection({ title, providers }: { title: string; providers: WatchProvider[] }) {
  if (!providers.length) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        {providers.map((p) => (
          <Chip
            key={p.provider_id}
            label={p.provider_name}
            avatar={
              p.logo_path ? (
                <img
                  src={tmdbImage(p.logo_path, "w185")}
                  alt={p.provider_name}
                  style={{ width: 20, height: 20, borderRadius: 4 }}
                />
              ) : undefined
            }
          />
        ))}
      </Stack>
    </Box>
  );
}
