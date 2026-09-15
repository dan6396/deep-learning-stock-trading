"""Frozen three-seed Huber ensemble. Outputs next-session open-to-close returns."""
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

from data import FEATURE_COLS, SEQ_LEN
from model import StockTransformer

DEFAULT_MANIFEST = Path(__file__).resolve().parent / "models/huber_ensemble/manifest.json"


class ChannelLinear(nn.Module):
    """Per-date projection; no convolution or mixing of neighboring dates."""
    def __init__(self, in_features, out_features):
        super().__init__()
        self.linear = nn.Linear(in_features, out_features)

    def forward(self, x):
        return self.linear(x.transpose(1, 2)).transpose(1, 2)


class HuberStockTransformer(StockTransformer):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Preserve the research checkpoint's parameter names for exact loading.
        self.conv_proj = nn.Sequential(
            ChannelLinear(self.n_features + self.time2vec_dim, self.d_model),
            nn.GELU(), nn.Dropout(kwargs.get("dropout", 0.3)),
        )


def _verified_path(root, entry):
    path = (root / entry["file"]).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Model asset must be inside the bundle directory")
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
        raise ValueError(f"Model asset checksum mismatch: {path.name}")
    return path


class HuberEnsemble:
    def __init__(self, manifest_path=DEFAULT_MANIFEST, device="cpu"):
        path = Path(manifest_path)
        spec = json.loads(path.read_text(encoding="utf-8"))
        if spec["format"] != "huber-return-ensemble-v1":
            raise ValueError("Unsupported ensemble format")
        if spec["features"] != FEATURE_COLS or spec["sequence_length"] != SEQ_LEN:
            raise ValueError("Feature order or sequence length does not match the model")
        if [m["seed"] for m in spec["members"]] != [42, 43, 44]:
            raise ValueError("The adopted ensemble requires seeds 42, 43 and 44")
        self.device = torch.device(device)
        self.spec = spec
        with np.load(_verified_path(path.parent, spec["scaler"]), allow_pickle=False) as s:
            self.mean, self.std = s["mean"].copy(), s["std"].copy()
            self.target_mean, self.target_std = float(s["target_mean"]), float(s["target_std"])
        if not (np.isfinite(self.mean).all() and np.isfinite(self.std).all()
                and (self.std > 0).all() and np.isfinite(self.target_mean)
                and np.isfinite(self.target_std) and self.target_std > 0):
            raise ValueError("Invalid training scaler")
        self.models = []
        for member in spec["members"]:
            model = HuberStockTransformer(**spec["model_args"]).to(self.device)
            state = torch.load(_verified_path(path.parent, member), map_location=self.device, weights_only=True)
            model.load_state_dict(state, strict=True)
            model.eval()
            self.models.append(model)

    def predict_windows(self, windows, batch_size=512):
        """Raw (unscaled) [N, 20, 11] features -> mean of three raw returns."""
        x = np.asarray(windows, dtype=np.float32)
        if x.ndim != 3 or x.shape[1:] != (SEQ_LEN, len(FEATURE_COLS)):
            raise ValueError("Expected [N, 20, 11] raw feature windows")
        if not np.isfinite(x).all() or batch_size < 1:
            raise ValueError("Non-finite input or invalid batch size")
        if len(x) == 0:
            return np.empty(0, dtype=np.float64)
        x = ((x - self.mean) / self.std).astype(np.float32)
        predictions = []
        with torch.inference_mode():
            for model in self.models:
                parts = []
                for start in range(0, len(x), batch_size):
                    batch = torch.from_numpy(x[start:start + batch_size]).to(self.device)
                    parts.append(model(batch).cpu().numpy())
                raw = np.concatenate(parts).astype(np.float64)
                predictions.append(raw * self.target_std + self.target_mean)
        return np.mean(predictions, axis=0)
