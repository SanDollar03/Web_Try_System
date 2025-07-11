from __future__ import annotations
from pathlib import Path
import pandas as pd

def read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def write_csv(df: pd.DataFrame, path: Path) -> None:
    path.write_text(df.to_csv(index=False, lineterminator="\n"), encoding="utf-8")


def ensure_columns(df: pd.DataFrame, cols: list[str]) -> None:
    """欠けている列を追加（空文字で初期化）"""
    for c in cols:
        if c not in df.columns:
            df[c] = ""
