// src/components/Navbar.tsx
import { Link } from "react-router-dom";
import { useState, Dispatch, SetStateAction } from "react";
import { recommendMovies, type MovieRecommendation } from "../utils/recommendMovies";

export interface NavbarProps {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  onRecommend: (results: MovieRecommendation[]) => void;
}

function Navbar({ query, setQuery, onRecommend }: NavbarProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const results = await recommendMovies(q, { language: "zh-TW", limit: 12 });
      onRecommend(results);
    } catch (e: any) {
      setError(e?.message ?? "Search failed");
      onRecommend([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <header className="apple-navbar">
      <nav className="navbar-content">
        <div
          style={{
            height: "80px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "0 5px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "15px",
              flex: 1,
            }}
          >
            {/* Logo */}
            <Link to="/" style={{ display: "block" }}>
              <img
                src="/ChatGPT Image 2 août 2025, 01_05_13.png"
                alt="reLivre"
                style={{
                  display: "block",
                  height: "200px",
                  width: "auto",
                  objectFit: "contain",
                  cursor: "pointer",
                  marginRight: "20px",
                }}
              />
            </Link>

            {/* 搜尋欄 + Filter */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                flex: 1,
              }}
            >
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type="text"
                  placeholder="用自然語言描述你想看的電影…（例如：90年代 搞笑 愛情，日文）"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  style={{
                    width: "100%",
                    padding: "12px 80px 12px 18px",
                    borderRadius: "22px",
                    border: "1px solid #ccc",
                    fontSize: "16px",
                    height: "48px",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    backgroundColor: "#649a8b",
                    color: "white",
                    padding: "8px 14px",
                    border: "none",
                    borderRadius: "20px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    height: "36px",
                  }}
                >
                  {loading ? "搜尋中…" : "搜尋"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {error && (
        <div style={{ color: "#fff", padding: "6px 12px", fontSize: 12 }}>{error}</div>
      )}
    </header>
  );
}

export default Navbar;
