// src/pages/SearchResultsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import { tmdbImage } from "../utils/tmdb";
import type { MovieRecommendation } from "../utils/recommendMovies";

type NavState = {
  results?: MovieRecommendation[];
  q?: string;
};

export default function SearchResultsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const navState = (location.state ?? {}) as NavState;
  const qFromUrl = String(searchParams.get("q") || "").trim();
  const qFromState = String(navState?.q || "").trim();

  const initialQuery = qFromUrl || qFromState;
  const initialResults = Array.isArray(navState?.results) ? navState.results : [];

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<MovieRecommendation[]>(initialResults);

  // Keep input in sync with URL (when user navigates with browser back/forward)
  useEffect(() => {
    const nextQ = String(searchParams.get("q") || "").trim();
    if (nextQ && nextQ !== query) setQuery(nextQ);
    if (!nextQ && query) {
      // If URL cleared, don't force-clear user input.
    }
  }, [searchParams, query]);

  const subtitle = useMemo(() => {
    if (!String(initialQuery || query).trim()) return "Type a query above to search";
    return results.length ? `${results.length} ${results.length === 1 ? "movie" : "movies"}` : "No results yet";
  }, [results.length, query, initialQuery]);

  const pageBg = "#f5f5f5"; // keep existing background
  const surface = "#fff";
  const ink = "#191e25";
  const muted = "#6e6e73";
  const cardShadow = "0 6px 18px rgba(0,0,0,0.06)";

  return (
    <>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults, usedQuery) => {
          const q = String(usedQuery || query || "").trim();
          setResults(nextResults);
          if (q) setSearchParams({ q });
        }}
      />

      <div style={{ backgroundColor: pageBg }}>
        <Container style={{ paddingTop: 18, paddingBottom: 44 }}>
          <div
            style={{
              background: surface,
              borderRadius: 16,
              boxShadow: cardShadow,
              padding: 18,
            }}
          >
            <SectionHeader
              title={query.trim() ? `Search results: ${query.trim()}` : "Search"}
              subtitle={subtitle}
            />

            {results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "44px 12px", color: muted, lineHeight: 1.6 }}>
                Enter a search in the top bar.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 14,
                  marginTop: 14,
                }}
              >
                {results.map((m) => {
                  const hasId = Number.isFinite(m.id) && m.id > 0;
                  const posterSrc = m.posterUrl
                    ? m.posterUrl
                    : m.poster_path
                      ? tmdbImage(m.poster_path, "w342")
                      : "";

                  return (
                    <div
                      key={`${m.id}|${String((m as any).imdbId || '')}|${m.title}|${m.release_date || ''}`}
                      onClick={() => {
                        if (hasId) navigate(`/movie/${m.id}`);
                      }}
                      style={{
                        background: surface,
                        borderRadius: 14,
                        boxShadow: cardShadow,
                        cursor: hasId ? "pointer" : "default",
                        overflow: "hidden",
                      }}
                      title={m.title}
                    >
                      <div style={{ aspectRatio: "2 / 3", background: "#f2f2f2" }}>
                        {posterSrc ? (
                          <img
                            src={posterSrc}
                            alt={m.title}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : null}
                      </div>
                      <div style={{ padding: 10 }}>
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 13,
                            color: ink,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {m.title}
                        </div>
                        <div style={{ fontSize: 12, color: muted, marginTop: 6 }}>
                          {m.release_date ? m.release_date.slice(0, 4) : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Container>
      </div>

      <Footer />
    </>
  );
}

function Container({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0 20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 10,
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#191e25", letterSpacing: "-0.02em" }}>
          {title}
        </h2>
        {subtitle ? <p style={{ margin: "8px 0 0", color: "#6e6e73", fontSize: 13 }}>{subtitle}</p> : null}
      </div>
    </div>
  );
}
