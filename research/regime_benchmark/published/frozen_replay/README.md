# Text-free frozen event replay inputs

These files contain fixed Huber forecasts, 394 categorical news-event labels, and article linkage IDs for the 30 selected sessions. They contain no article text, headline, URL, stock price, realized per-stock return, or API credential.

With an authorized local OHLCV file matching the canonical price hash in `manifest.json`, the [Korean reproduction guide](../../REPRODUCE_KO.md) and `verify_replay.py` reproduce the downstream ranking and portfolio results. They cannot reproduce the original article collection or Gemini extraction, and the archived article versions were not verified as point-in-time snapshots.
