from pathlib import Path
import pandas as pd

def read_csv(path: Path, *, columns: list[str] | None = None) -> pd.DataFrame:
    """
    空ファイル・未作成ファイルでも DataFrame を返す安全版 read_csv
    - columns を渡すと、そのヘッダーで空 DataFrame を生成
    """
    if not path.exists() or path.stat().st_size == 0:
        return pd.DataFrame(columns=columns or [])
    try:
        return pd.read_csv(path, dtype=str, keep_default_na=False)
    except pd.errors.EmptyDataError:
        return pd.DataFrame(columns=columns or [])

def write_csv(df: pd.DataFrame, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8-sig")

def ensure_columns(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """指定列が無ければ追加して返す（中身は空文字列）"""
    for c in cols:
        if c not in df.columns:
            df[c] = ""
    return df
