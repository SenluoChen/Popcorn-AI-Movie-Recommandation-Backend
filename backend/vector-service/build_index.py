from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import numpy as np


def _resolve_local_root(cli_value: str | None = None) -> Path:
    raw = cli_value or os.environ.get("LOCAL_DATA_PATH")
    if not raw or not str(raw).strip():
        raise ValueError(
            "Missing LOCAL_DATA_PATH. Set env var LOCAL_DATA_PATH to a local output folder."
        )
    return Path(str(raw)).expanduser().resolve()


def _iter_ndjson(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            s = line.strip()
            if not s:
                continue
            if s.startswith("#") or s.startswith("//"):
                continue
            try:
                obj = json.loads(s)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            obj["__line__"] = i + 1
            out.append(obj)
    return out


def _stable_key(m: dict[str, Any]) -> str:
    imdb_id = str(m.get("imdbId") or "").strip()
    if imdb_id:
        return imdb_id
    movie_id = str(m.get("id") or "").strip()
    if movie_id:
        return movie_id
    key = str(m.get("key") or "").strip()
    if key:
        return key
    title = str(m.get("title") or "").strip().lower()
    year = str(m.get("year") or "").strip()
    if title and year:
        return f"{title}|{year}"
    if title:
        return f"title:{title}"
    return ""


def _coerce_vector(v: Any, *, expected_dim: int | None) -> np.ndarray | None:
    if not isinstance(v, list) or len(v) == 0:
        return None
    if expected_dim is not None and len(v) != expected_dim:
        return None
    try:
        arr = np.asarray(v, dtype=np.float32)
    except Exception:
        return None
    if arr.ndim != 1:
        return None
    if not np.all(np.isfinite(arr)):
        return None
    return arr


def build_faiss_index(*, movies_ndjson: Path, vectors_ndjson: Path, out_index: Path, out_meta: Path) -> None:
    movies_rows = _iter_ndjson(movies_ndjson)
    movie_by_key: dict[str, dict[str, Any]] = {}
    for m in movies_rows:
        key = _stable_key(m)
        if not key:
            continue
        movie_by_key[key] = m

    vector_rows = _iter_ndjson(vectors_ndjson)
    if not vector_rows:
        raise ValueError(f"No vectors found in {vectors_ndjson}")

    inferred_dim: int | None = None
    for r in vector_rows:
        vec = r.get("vector")
        if isinstance(vec, list) and len(vec) > 0:
            inferred_dim = len(vec)
            break
    if inferred_dim is None:
        raise ValueError(f"No valid vectors found in {vectors_ndjson}")

    vectors: list[np.ndarray] = []
    metas: list[dict[str, Any]] = []
    skipped = 0

    for r in vector_rows:
        key = str(r.get("key") or "").strip() or _stable_key(r)
        if not key:
            skipped += 1
            continue

        vec = _coerce_vector(r.get("vector"), expected_dim=inferred_dim)
        if vec is None:
            skipped += 1
            continue

        m = movie_by_key.get(key) or {}
        imdb_id = (m.get("imdbId") if isinstance(m, dict) else None) or r.get("imdbId")
        movie_id = (m.get("id") if isinstance(m, dict) else None) or r.get("id")

        vectors.append(vec)
        metas.append(
            {
                "imdbId": imdb_id,
                "id": movie_id,
                "key": key,
                "title": (m.get("title") if isinstance(m, dict) else None) or r.get("title"),
                "year": (m.get("year") if isinstance(m, dict) else None) or r.get("year"),
                "genre": (m.get("genre") if isinstance(m, dict) else None) or r.get("genre"),
                "productionCountry": (m.get("productionCountry") if isinstance(m, dict) else None)
                or r.get("productionCountry"),
                "moodTags": (m.get("moodTags") if isinstance(m, dict) else None) or r.get("moodTags") or [],
            }
        )

    if not vectors:
        raise ValueError("No valid vectors to index")

    mat = np.stack(vectors, axis=0).astype(np.float32, copy=False)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    mat = mat / norms

    import faiss  # local import so error message is clearer if missing

    index = faiss.IndexFlatIP(inferred_dim)
    index.add(mat)

    out_index.parent.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(out_index))

    meta_obj = {
        "dim": inferred_dim,
        "count": len(metas),
        "skipped": skipped,
        "items": metas,
    }
    out_meta.parent.mkdir(parents=True, exist_ok=True)
    out_meta.write_text(json.dumps(meta_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] Indexed {len(metas)} item(s). skipped={skipped} dim={inferred_dim}")
    print(f"[OK] Wrote: {out_index}")
    print(f"[OK] Wrote: {out_meta}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build FAISS index from LOCAL_DATA_PATH NDJSON files (movies + embeddings)"
    )
    parser.add_argument(
        "--local-data-path",
        default=os.environ.get("LOCAL_DATA_PATH", ""),
        help="Root folder containing movies/, vectors/, index/ (default: env LOCAL_DATA_PATH)",
    )
    parser.add_argument(
        "--movies",
        default="",
        help="Path to movies NDJSON (default: LOCAL_DATA_PATH/movies/movies.ndjson)",
    )
    parser.add_argument(
        "--vectors",
        default="",
        help="Path to embeddings NDJSON (default: LOCAL_DATA_PATH/vectors/embeddings.ndjson)",
    )
    parser.add_argument(
        "--out-index",
        default="",
        help="Output FAISS index path (default: LOCAL_DATA_PATH/index/faiss.index)",
    )
    parser.add_argument(
        "--out-meta",
        default="",
        help="Output metadata JSON path (default: LOCAL_DATA_PATH/index/meta.json)",
    )
    args = parser.parse_args()

    root = _resolve_local_root(args.local_data_path)
    movies_ndjson = Path(args.movies) if args.movies else (root / "movies" / "movies.ndjson")
    vectors_ndjson = Path(args.vectors) if args.vectors else (root / "vectors" / "embeddings.ndjson")
    out_index = Path(args.out_index) if args.out_index else (root / "index" / "faiss.index")
    out_meta = Path(args.out_meta) if args.out_meta else (root / "index" / "meta.json")

    build_faiss_index(
        movies_ndjson=movies_ndjson,
        vectors_ndjson=vectors_ndjson,
        out_index=out_index,
        out_meta=out_meta,
    )


if __name__ == "__main__":
    main()
