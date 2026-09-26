"""Publish only model-derived features and aggregate replay results, never source data."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np
import pandas as pd

from run_news_event_residual import NEWS_COLUMNS, OUT as RUN_OUT, SOURCE, prepare


DEST = Path("research/regime_benchmark/published")
FIGURE = Path("figures/news_event_regime_comparison.png")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def publish():
    DEST.mkdir(parents=True, exist_ok=True)
    FIGURE.parent.mkdir(parents=True, exist_ok=True)
    source_protocol = json.loads((SOURCE / "protocol.json").read_text(encoding="utf-8"))
    date_regime = {date: regime for regime, dates in source_protocol["selected_entry_dates"].items()
                   for date in dates}
    panel, _ = prepare()
    panel["regime"] = panel.entry_date.dt.strftime("%Y-%m-%d").map(date_regime)
    panel["price_rank"] = panel.groupby("entry_date").huber_ensemble.rank(
        ascending=False, method="first").astype(int)
    safe_columns = ["date", "entry_date", "ticker", "regime", "huber_ensemble",
                    "price_rank", "price_context", "event_presence", *NEWS_COLUMNS]
    numeric = panel[safe_columns].sort_values(["entry_date", "ticker"])
    numeric.to_csv(DEST / "numeric_features.csv.gz", index=False, compression="gzip",
                   date_format="%Y-%m-%d")
    scores = pd.read_parquet(RUN_OUT / "scores.parquet")
    safe_scores = ["date", "entry_date", "ticker", "price", "presence", "event_fixed",
                   "event_gated", "event_delta", "event_presence"]
    scores[safe_scores].sort_values(["entry_date", "ticker"]).to_csv(
        DEST / "model_scores.csv.gz", index=False, compression="gzip", date_format="%Y-%m-%d")
    metrics = pd.read_csv(RUN_OUT / "metrics.csv")
    daily = pd.read_csv(RUN_OUT / "daily.csv")
    metrics.to_csv(DEST / "metrics.csv", index=False, encoding="utf-8")
    daily.to_csv(DEST / "daily_equity.csv", index=False, encoding="utf-8")
    sessions = pd.DataFrame([{"entry_date": date, "regime": regime}
                             for date, regime in date_regime.items()]).sort_values("entry_date")
    sessions.to_csv(DEST / "regime_dates.csv", index=False, encoding="utf-8")

    plt.rcParams.update({"font.size": 10, "font.family": "Malgun Gothic",
                         "axes.spines.top": False, "axes.spines.right": False})
    fig, axes = plt.subplots(1, 3, figsize=(13.8, 4.3), sharey=True)
    styles = {"price": ("#1764c0", "가격 단독"),
              "event_fixed": ("#e87722", "가격 + 뉴스 사건 보정")}
    for ax, (regime, label) in zip(axes, [("sideways", "횡보: 후반 5거래일"),
                                         ("down", "하락: 10거래일"), ("up", "상승: 10거래일")]):
        ax.axhline(10, color="#9ca3af", linewidth=1, linestyle="--")
        for strategy, (color, name) in styles.items():
            group = daily[(daily.regime == regime) & (daily.strategy == strategy)
                          & (daily.turnover == "top5")].sort_values("date")
            if group.empty:
                raise ValueError(f"Missing daily equity for {regime}/{strategy}")
            values = np.r_[10_000_000, group.end_equity.to_numpy(float)] / 1_000_000
            ax.plot(range(len(values)), values, marker="o", markersize=3, linewidth=2.2,
                    color=color, label=name)
            ax.text(len(values)-1, values[-1], f" {values[-1]:.2f}m", color=color,
                    va="center", fontsize=9)
        ax.set_title(label, fontweight="bold")
        ax.set_xlim(0, 5 if regime == "sideways" else 10)
        ax.set_ylim(9.0, 12.5)
        ax.set_xlabel("경과 거래일")
        ax.grid(alpha=.18)
    axes[0].set_ylabel("최종 자산 (백만원)")
    handles = [Line2D([0], [0], color=color, linewidth=2.2, marker="o", markersize=4,
                      label=name) for color, name in styles.values()]
    fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(.5, .92), ncol=2, frameon=False)
    fig.suptitle("각각 1,000만원 투자 · Top-5 유지/교체 · 매매 편도 비용 0.125%", y=.99, fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .81))
    fig.savefig(FIGURE, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    files = [DEST / name for name in ("numeric_features.csv.gz", "model_scores.csv.gz",
                                      "metrics.csv", "daily_equity.csv", "regime_dates.csv")]
    manifest = {
        "version": "regime-benchmark-derived-v1",
        "rows": {"numeric_features": len(numeric), "model_scores": len(scores),
                 "daily_equity": len(daily)},
        "files_sha256": {path.name: sha(path) for path in files},
        "excluded": ["raw OHLCV", "realized per-stock returns", "news text", "headlines", "URLs", "API credentials"],
        "interpretation": "Exploratory reused dates; first five sideways sessions used for training",
    }
    (DEST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(manifest["rows"], FIGURE)


if __name__ == "__main__":
    publish()
