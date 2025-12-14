import { useMemo, useState } from 'react';

type SearchResult = {
  imdbId: string;
  title: string;
  year?: string;
  similarity: number;
  productionCountry?: string;
};

function getApiBaseUrl(): string {
  const raw =
    process.env.REACT_APP_RELIVRE_API_URL
    || process.env.REACT_APP_API_URL
    || '';

  const base = String(raw).trim();
  if (!base) return '';
  return base.endsWith('/') ? base : `${base}/`;
}

export default function AwsVectorSearch() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [results, setResults] = useState<SearchResult[]>([]);

  const canSearch = Boolean(apiBaseUrl);

  async function onSearch() {
    const q = query.trim();
    if (!q) {
      setError('請先輸入一句話再搜尋。');
      return;
    }

    if (!canSearch) {
      setError('尚未設定 API URL（REACT_APP_RELIVRE_API_URL）。');
      return;
    }

    setLoading(true);
    setError('');
    setResults([]);

    try {
      const resp = await fetch(`${apiBaseUrl}search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: q, topK: 5 }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(String(data?.error || `HTTP ${resp.status}`));
      }

      const list = Array.isArray(data?.results) ? data.results : [];
      setResults(list);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 6px 18px rgba(0,0,0,0.06)',
        padding: 16,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16 }}>AI 向量搜尋（雲端）</div>
      <div style={{ color: '#6e6e73', marginTop: 6, fontSize: 13 }}>
        這會呼叫 AWS API（OpenAI embedding + DynamoDB 向量資料）
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSearch();
            }
          }}
          placeholder='例如：不血腥的懸疑推理、想看棒球電影、外星人冒險…'
          style={{
            flex: '1 1 420px',
            minWidth: 260,
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.12)',
            padding: '10px 12px',
            outline: 'none',
          }}
        />
        <button
          onClick={onSearch}
          disabled={loading}
          style={{
            borderRadius: 10,
            border: 'none',
            padding: '10px 14px',
            background: '#111',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '搜尋中…' : '搜尋'}
        </button>
      </div>

      {!canSearch ? (
        <div style={{ marginTop: 10, color: '#b42318', fontSize: 13 }}>
          尚未設定 API URL。請在 build 時設定環境變數：REACT_APP_RELIVRE_API_URL
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 10, color: '#b42318', fontSize: 13 }}>{error}</div>
      ) : null}

      {results.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Top 5</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {results.map((r) => (
              <div
                key={r.imdbId}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.08)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.title}{r.year ? ` (${r.year})` : ''}
                  </div>
                  <div style={{ color: '#6e6e73', marginTop: 4, fontSize: 12 }}>
                    {r.productionCountry ? `原產地：${r.productionCountry} · ` : ''}
                    <a href={`https://www.imdb.com/title/${r.imdbId}/`} target='_blank' rel='noreferrer' style={{ color: '#6e6e73' }}>
                      {r.imdbId}
                    </a>
                  </div>
                </div>
                <div style={{ fontVariantNumeric: 'tabular-nums', color: '#111', fontWeight: 700 }}>
                  {Number(r.similarity).toFixed(3)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
