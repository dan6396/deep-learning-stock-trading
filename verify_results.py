# -*- coding: utf-8 -*-
"""
verify_results.py — 핵심 결과 재현/검증 (최근 12개월 구간, test 50종목)

무엇을 검증하나
--------------
README 의 핵심 결과 수치를, 학습에 쓰지 않은 test 50종목(shared_test_raw.parquet)과
고정 체크포인트(transformer_5y.pt)만으로 재실행하여 재현한다. 재학습·난수 없음 → 결정론적.

  구간(기본): 2025-06-01 ~ 2026-05-28  (거래일 241, 최근 약 12개월)
  유니버스  : test 50종목 (종목기준 out-of-sample)
  전략      : 매 거래일 P(up) 상위 topk 동일가중 매수 → 익일 종가 청산
  시장 기준선: 같은 50종목 동일가중, 매일 리밸런싱  (KOSPI200 지수 아님)
  비용      : 왕복 0.25% 를 매 거래일 flat 차감(net). gross 는 비용 전.

재현되는 값 (기본 구간 기준)
  DA(방향정확도)        56.26%
  Rank IC / ICIR        0.0753 / 0.4111
  Top-5 누적 gross/net   +224.7% / +78.11%
  시장 누적 gross/net    +65.08% / -9.59%

주의: 지표는 구간에 민감하다. 9년 전체(2017-01~)로 돌리면 DA 53.5% / IC 0.051 /
      net 은 전략 -77%·시장 -98.6% 로 떨어진다. README 헤드라인은 '최근 12개월' 구간 값이다.

의존: predict.py(_load_inference_bundle), data.py(_compute_indicators 등) — 코어 모듈만 사용.
      (별도 백테스트 스크립트에 의존하지 않는 self-contained 버전)

실행
  python verify_results.py
  python verify_results.py --start 2025-06-01 --end 2026-05-28 --topk 5 --cost 0.25
"""
from __future__ import annotations

import argparse
import sys
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import torch  # noqa: E402

from predict import _load_inference_bundle  # 모델/스케일러 1회 로드  # noqa: E402
from data import _compute_indicators, FEATURE_COLS, SEQ_LEN, N_FEATURES  # noqa: E402

OHLCV_COLS = ["Open", "High", "Low", "Close", "Volume"]


# ────────────────────────────────────────────────────────────────────
# 데이터 로드 + 누수 없는 20일 윈도우 일괄 생성
# ────────────────────────────────────────────────────────────────────

def load_parquet(parquet_path: Path) -> dict[str, pd.DataFrame]:
    if not parquet_path.exists():
        raise FileNotFoundError(f"parquet 없음: {parquet_path}")
    df = pd.read_parquet(parquet_path)
    if "Ticker" not in df.columns:
        raise ValueError("parquet 에 'Ticker' 컬럼이 없습니다.")
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)
    out: dict[str, pd.DataFrame] = {}
    for ticker, grp in df.groupby("Ticker"):
        out[str(ticker).zfill(6)] = grp[OHLCV_COLS].sort_index().copy()
    return out


def build_all_windows(ohlcv: dict[str, pd.DataFrame]) -> tuple[np.ndarray, pd.DataFrame]:
    """전 종목의 모든 유효 20일 윈도우 + meta[date,ticker,ret_next]. 윈도우는 D 까지, 수익률은 D+1."""
    X_list: list[np.ndarray] = []
    rows: list[dict[str, Any]] = []
    for ticker, g in ohlcv.items():
        g = g.sort_index()
        if len(g) < SEQ_LEN + 1:
            continue
        feat_df = _compute_indicators(g)
        feat = feat_df[FEATURE_COLS].values.astype(np.float32)
        close = g["Close"].astype(float).values
        dates = g.index
        n = len(feat)
        for i in range(SEQ_LEN - 1, n):
            window = feat[i - SEQ_LEN + 1 : i + 1]
            if window.shape[0] != SEQ_LEN or not np.isfinite(window).all():
                continue
            ret_next = (close[i + 1] - close[i]) / close[i] if (i + 1 < n and close[i] > 0) else np.nan
            X_list.append(window)
            rows.append({"date": pd.Timestamp(dates[i]).normalize(), "ticker": ticker, "ret_next": ret_next})
    if not X_list:
        return (np.empty((0, SEQ_LEN, N_FEATURES), dtype=np.float32),
                pd.DataFrame(columns=["date", "ticker", "ret_next"]))
    return np.stack(X_list).astype(np.float32), pd.DataFrame(rows)


def batch_predict(bundle: dict[str, Any], X: np.ndarray, batch_size: int = 4096) -> np.ndarray:
    """체크포인트 스케일러 변환 후 배치 추론 → P(up). 재학습 없음."""
    if len(X) == 0:
        return np.empty(0, dtype=np.float32)
    device, model, scaler, task = bundle["device"], bundle["model"], bundle["scaler"], bundle["task"]
    Xs = scaler.transform(X).astype(np.float32)
    preds = np.empty(len(Xs), dtype=np.float32)
    model.eval()
    with torch.no_grad():
        for s in range(0, len(Xs), batch_size):
            raw = model(torch.from_numpy(Xs[s : s + batch_size]).to(device))
            if task == "classification":
                raw = torch.sigmoid(raw)
            preds[s : s + batch_size] = raw.detach().cpu().numpy().ravel()
    return preds


def cum(x: np.ndarray) -> float:
    x = np.asarray(x, dtype=float)
    return float(np.prod(1.0 + x) - 1.0) if len(x) else float("nan")


# ────────────────────────────────────────────────────────────────────
# main
# ────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="핵심 결과 재현/검증 (최근 12개월, test 50종목)")
    p.add_argument("--parquet", default=str(BASE_DIR / "shared_test_raw.parquet"))
    p.add_argument("--ckpt", default=str(BASE_DIR / "transformer_5y.pt"))
    p.add_argument("--start", default="2025-06-01", help="검증 시작일")
    p.add_argument("--end", default="2026-05-28", help="검증 종료일")
    p.add_argument("--topk", type=int, default=5)
    p.add_argument("--cost", type=float, default=0.25, help="왕복 거래비용 (퍼센트)")
    p.add_argument("--batch-size", type=int, default=4096)
    p.add_argument("--device", default="cpu")
    p.add_argument("--plot", action="store_true", help="figures/ 에 차트 저장")
    p.add_argument("--figdir", default=str(BASE_DIR / "figures"))
    args = p.parse_args()

    start = pd.Timestamp(args.start).normalize()
    end = pd.Timestamp(args.end).normalize()
    cost = args.cost / 100.0

    print("=" * 68)
    print("핵심 결과 재현 (test 50종목, 종목기준 out-of-sample)")
    print("=" * 68)

    ohlcv = load_parquet(Path(args.parquet))
    X, meta = build_all_windows(ohlcv)
    bundle = _load_inference_bundle(str(Path(args.ckpt)), args.device)
    meta["p_up"] = batch_predict(bundle, X, args.batch_size)

    m = meta.dropna(subset=["ret_next", "p_up"]).copy()
    m = m[(m["date"] >= start) & (m["date"] <= end)].sort_values("date")
    if m["date"].nunique() < 2:
        print("[중단] 구간 내 거래일이 부족합니다.")
        sys.exit(1)

    print(f"  종목수 {len(ohlcv)} | 구간 {m['date'].min().date()} ~ {m['date'].max().date()} "
          f"| 거래일 {m['date'].nunique()} | 관측 {len(m):,}")

    # 1) 방향정확도 DA
    pred_up = m["p_up"] > 0.5
    act_up = m["ret_next"] > 0
    DA = float((pred_up == act_up).mean()) * 100

    # 2) Rank IC / ICIR (일별 spearman 평균)
    ics = []
    dates, tr, mkt, hit = [], [], [], []
    for D, g in m.groupby("date"):
        if len(g) >= 3:
            c = g["p_up"].corr(g["ret_next"], method="spearman")
            if np.isfinite(c):
                ics.append(c)
        gg = g.sort_values("p_up", ascending=False)
        rr = gg["ret_next"].values
        kk = min(args.topk, len(rr))
        dates.append(D)
        tr.append(float(np.mean(rr[:kk])))
        mkt.append(float(np.mean(rr)))
        hit.append(float(np.mean(rr[:kk])) > 0)
    ics = np.array(ics)
    dates = pd.to_datetime(dates)
    tr = np.array(tr)
    mkt = np.array(mkt)
    IC = float(ics.mean())
    ICIR = float(ics.mean() / ics.std(ddof=1))

    # 3) 누적수익
    tr_g, tr_n = cum(tr) * 100, cum(tr - cost) * 100
    mkt_g, mkt_n = cum(mkt) * 100, cum(mkt - cost) * 100

    print("\n[검증 결과]")
    print(f"  1) DA(방향정확도, p_up>0.5 vs 익일상승) = {DA:6.2f}%")
    print(f"  2) Rank IC = {IC:.4f}   ICIR = {ICIR:.4f}   (일별 spearman, {len(ics)}일)")
    print(f"  3) Top-{args.topk} 누적: gross {tr_g:+.2f}%   net(왕복{args.cost}%/일) {tr_n:+.2f}%")
    print(f"  4) 시장(50종목 EW 일별리밸): gross {mkt_g:+.2f}%   net {mkt_n:+.2f}%")
    print(f"     Top-{args.topk} 적중률(일 상승비율) = {float(np.mean(hit))*100:.2f}%")

    print("\n[README 기재값 대조]")
    def chk(name, got, want, tol):
        ok = abs(got - want) <= tol
        print(f"  {name:<26} 재현 {got:>9.4f}  기대 {want:>8}  → {'일치' if ok else '불일치'}")
    chk("DA(%)", DA, 56.3, 0.15)
    chk("Rank IC", IC, 0.075, 0.002)
    chk("ICIR", ICIR, 0.411, 0.01)
    chk("Top-5 net(%)", tr_n, 78.1, 0.5)
    chk("시장 net(%)", mkt_n, -9.6, 0.3)

    # 5) (선택) 차트 저장
    if args.plot:
        figdir = Path(args.figdir)
        figdir.mkdir(parents=True, exist_ok=True)
        save_figures(figdir, dates, tr, mkt, cost, args.topk,
                     dict(DA=DA, IC=IC, ICIR=ICIR,
                          tr_g=tr_g, tr_n=tr_n, mkt_g=mkt_g, mkt_n=mkt_n))
        print(f"\n저장: {figdir/'backtest_cumulative.png'}")
        print(f"저장: {figdir/'backtest_summary.png'}")


# ────────────────────────────────────────────────────────────────────
# 차트 (선택: --plot)
# ────────────────────────────────────────────────────────────────────

def save_figures(figdir: Path, dates, tr, mkt, cost, topk, s: dict) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    for name in ["AppleGothic", "Malgun Gothic", "NanumGothic"]:
        if any(f.name == name for f in font_manager.fontManager.ttflist):
            plt.rcParams["font.family"] = name
            break
    plt.rcParams["axes.unicode_minus"] = False

    C_TR, C_MKT = "#EE4C2C", "#7f7f7f"
    tr_curve = (np.cumprod(1 + (tr - cost)) - 1) * 100
    mkt_curve = (np.cumprod(1 + (mkt - cost)) - 1) * 100
    period = f"{dates[0].date()} ~ {dates[-1].date()} · {len(dates)}거래일 · test 50종목 out-of-sample"

    # (1) 누적수익 곡선 (net)
    fig, ax = plt.subplots(figsize=(11, 6))
    ax.plot(dates, tr_curve, color=C_TR, lw=2.0, label=f"Transformer Top-{topk} (net)")
    ax.plot(dates, mkt_curve, color=C_MKT, lw=1.8, label="시장 벤치마크 (50종목 EW, net)")
    ax.axhline(0, color="black", lw=0.8, ls="--", alpha=0.5)
    ax.annotate(f"{s['tr_n']:+.1f}%", (dates[-1], tr_curve[-1]), color=C_TR,
                fontsize=12, fontweight="bold", va="center", ha="left",
                xytext=(6, 0), textcoords="offset points")
    ax.annotate(f"{s['mkt_n']:+.1f}%", (dates[-1], mkt_curve[-1]), color=C_MKT,
                fontsize=12, fontweight="bold", va="center", ha="left",
                xytext=(6, 0), textcoords="offset points")
    ax.set_title("누적수익 (net, 왕복 0.25% 차감)\n" + period, fontsize=12)
    ax.set_xlabel("날짜"); ax.set_ylabel("누적수익 (%)")
    ax.legend(loc="upper left"); ax.grid(True, alpha=0.3)
    ax.margins(x=0.08)
    fig.autofmt_xdate(); fig.tight_layout()
    fig.savefig(figdir / "backtest_cumulative.png", dpi=150); plt.close(fig)

    # (2) gross/net 요약 막대 + 핵심 지표
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 5), gridspec_kw={"width_ratios": [1.4, 1]})
    labels = ["전략 gross", "전략 net", "시장 gross", "시장 net"]
    vals = [s["tr_g"], s["tr_n"], s["mkt_g"], s["mkt_n"]]
    colors = ["#EE4C2C", "#F6A08C", "#7f7f7f", "#bdbdbd"]
    bars = a1.bar(labels, vals, color=colors)
    a1.axhline(0, color="black", lw=0.8)
    a1.set_title("누적수익: 전략 vs 시장 (gross/net)"); a1.set_ylabel("%")
    a1.grid(True, axis="y", alpha=0.3)
    for b, v in zip(bars, vals):
        a1.text(b.get_x() + b.get_width() / 2, v, f"{v:+.1f}",
                ha="center", va="bottom" if v >= 0 else "top", fontsize=10, fontweight="bold")
    a2.axis("off")
    rows = [("방향정확도 (DA)", f"{s['DA']:.1f}%"),
            ("Rank IC", f"{s['IC']:.3f}"),
            ("ICIR", f"{s['ICIR']:.3f}")]
    y = 0.82
    for lab, val in rows:
        a2.text(0.02, y, lab, fontsize=14, va="center")
        a2.text(0.98, y, val, fontsize=14, va="center", ha="right", fontweight="bold", color="#EE4C2C")
        y -= 0.16
    a2.text(0.02, 0.18, "측정: 최근 12개월\ntest 50종목 out-of-sample",
            fontsize=11, va="center", color="#555555")
    a2.set_xlim(0, 1); a2.set_ylim(0, 1)
    fig.tight_layout()
    fig.savefig(figdir / "backtest_summary.png", dpi=150); plt.close(fig)


if __name__ == "__main__":
    main()
