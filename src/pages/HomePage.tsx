// src/pages/HomePage.tsx
import { useState } from "react";
import "../App.css";
import { useNavigate } from "react-router-dom";

import BannerCarousel from "../components/BannerCarousel";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import { tmdbImage } from "../utils/tmdb";
import type { MovieRecommendation } from "../utils/recommendMovies";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieRecommendation[]>([]);
  const navigate = useNavigate();

  return (
    <>
      <Navbar query={query} setQuery={setQuery} onRecommend={setResults} />

      <div style={{ backgroundColor: "#fff" }}>
        <Container style={{ paddingTop: 12, paddingBottom: 35 }}>
          <BannerCarousel />
        </Container>
      </div>

      <Hairline mt={18} mb={0} />

      <div style={{ backgroundColor: "#fff" }}>
        <Container style={{ paddingTop: 30, paddingBottom: 40 }}>
          <SectionHeader title="推薦結果" subtitle={results.length ? `${results.length} 部` : ""} />

          {results.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 12px", color: "#6e6e73" }}>
              請用一句話描述你想看的電影，例如：
              <br />
              「90年代 搞笑 愛情片，日文」或「不血腥的懸疑推理」。
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 16,
                marginTop: 18,
              }}
            >
              {results.map((m) => (
                <div
                  key={m.id}
                  onClick={() => navigate(`/movie/${m.id}`)}
                  style={{
                    background: "#fff",
                    borderRadius: 12,
                    boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ height: 260, background: "#f2f2f2" }}>
                    {m.poster_path ? (
                      <img
                        src={tmdbImage(m.poster_path, "w342")}
                        alt={m.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : null}
                  </div>

                  <div style={{ padding: 12 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={m.title}
                    >
                      {m.title}
                    </div>
                    <div style={{ fontSize: 12, color: "#6e6e73", marginTop: 6 }}>
                      {m.release_date ? m.release_date.slice(0, 4) : ""}
                      {m.vote_average ? ` · ★ ${m.vote_average.toFixed(1)}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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

function Hairline({ mt = 16, mb = 16 }: { mt?: number; mb?: number }) {
  return (
    <div
      style={{
        height: 1,
        background:
          "linear-gradient(to right, rgba(0,0,0,0.06), rgba(0,0,0,0.04), rgba(0,0,0,0.02), transparent)",
        marginTop: mt,
        marginBottom: mb,
      }}
    />
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
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
        {subtitle ? <p style={{ margin: "6px 0 0", color: "#6e6e73" }}>{subtitle}</p> : null}
      </div>
    </div>
  );
}
