"""Fit the diagnostic news residual and freeze its inactive live manifest."""
from __future__ import annotations

import json
from pathlib import Path

from sklearn.linear_model import Ridge

from run_news_event_residual import ALPHA, MAX_DELTA, NEWS_COLUMNS, OUT, prepare, read, sha


def main():
    frame, _ = prepare()
    history = read(OUT / "fit_history.json")
    if any(row["gate_enabled"] for row in history):
        raise ValueError("Review activation before exporting a live model")
    columns = NEWS_COLUMNS + [f"context_{name}" for name in NEWS_COLUMNS]
    model = Ridge(alpha=ALPHA, fit_intercept=False)
    model.fit(frame[columns].to_numpy(float), frame.residual.to_numpy(float))
    manifest = {
        "version": "event-residual-v1",
        "training_sessions": [str(frame.entry_date.min().date()), str(frame.entry_date.max().date())],
        "trained_stock_days": len(frame),
        "event_columns": NEWS_COLUMNS,
        "feature_columns": columns,
        "coefficients": [float(value) for value in model.coef_],
        "alpha": ALPHA,
        "max_delta": MAX_DELTA,
        "active": False,
        "activation_reason": "No news correction passed the past-only validation gate on 25 evaluated sessions",
        "validation_enabled_days": 0,
        "validation_evaluated_days": len(history),
        "original_extractor": "Gemini sentiment/relevance/event_type; later event-state labels unavailable for historical fit",
        "source_hashes": {
            "scored_panel": sha(Path("outputs/news_guarded_calendar3_v2/scored_panel.parquet")),
            "fit_history": sha(OUT / "fit_history.json"),
        },
    }
    target = Path("models/news_event_residual_v1/manifest.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(target, "active=", manifest["active"], "coefficients=", len(manifest["coefficients"]))


if __name__ == "__main__":
    main()
