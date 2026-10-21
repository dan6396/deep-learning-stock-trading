"""Frozen temporal Transformer inference architecture (20 / 120 sessions)."""
import torch
from torch import nn

class Time2Vec(nn.Module):
    def __init__(self, dimensions: int = 4):
        super().__init__()
        self.frequency = nn.Parameter(torch.randn(dimensions))
        self.phase = nn.Parameter(torch.zeros(dimensions))

    def forward(self, length: int, reference: torch.Tensor) -> torch.Tensor:
        time = torch.arange(length, device=reference.device, dtype=reference.dtype)
        value = time[:, None] * self.frequency + self.phase
        return torch.cat([value[:, :1], value[:, 1:].sin()], dim=-1)


class TemporalRankTransformer(nn.Module):
    """Temporal Transformer with last-state/attention pooling and two output heads.

    stock: [dates, stocks, lookback, 11], market: [dates, 10].
    available: [dates, stocks], based ONLY on information available at the cutoff.
    Inter-stock attention is an optional ablation, not a required expert design.
    """
    def __init__(self, stock_features=11, market_features=10, width=64,
                 heads=4, layers=2, dropout=.1, stock_attention=False):
        super().__init__()
        if width % heads or layers < 1:
            raise ValueError("Invalid Transformer dimensions")
        self.stock_features = stock_features
        self.market_features = market_features
        self.width = width
        self.time = Time2Vec(4)
        self.projection = nn.Sequential(nn.Linear(stock_features + 4, width),
                                        nn.GELU(), nn.Dropout(dropout))
        block = nn.TransformerEncoderLayer(width, heads, 2 * width, dropout,
                    activation="gelu", batch_first=True, norm_first=True)
        self.temporal = nn.TransformerEncoder(block, layers, enable_nested_tensor=False)
        self.pool_score = nn.Linear(width, 1)
        self.pool_combine = nn.Sequential(nn.Linear(2 * width, width), nn.GELU())
        self.market_encoder = nn.Sequential(nn.Linear(market_features, 16), nn.GELU(),
                                            nn.Linear(16, width))
        self.market_modulation = nn.Linear(width, width)
        self.spatial = (nn.TransformerEncoderLayer(width, heads, 2 * width, dropout,
                        activation="gelu", batch_first=True, norm_first=True)
                        if stock_attention else None)
        self.output_norm = nn.LayerNorm(width)
        self.return_head = nn.Linear(width, 1)
        self.direction_head = nn.Linear(width, 1)

    def forward(self, stock, market, available):
        if stock.ndim != 4:
            raise ValueError("Stock input must be [date, stock, time, feature]")
        b, n, t, f = stock.shape
        if f != self.stock_features or t < 1 or market.shape != (b, self.market_features):
            raise ValueError("Input dimensions disagree")
        if available.shape != (b, n) or available.dtype != torch.bool:
            raise ValueError("Availability must be a boolean date-stock mask")
        if not available.any(dim=1).all():
            raise ValueError("Every date must have at least one available stock")
        if not torch.isfinite(stock[available]).all() or not torch.isfinite(market).all():
            raise ValueError("Available inputs must be finite")
        # Missing-stock placeholders cannot influence available stocks.
        stock = torch.where(available[..., None, None], stock, torch.zeros_like(stock))
        temporal = self.time(t, stock).expand(b, n, t, -1)
        z = self.projection(torch.cat([stock, temporal], dim=-1)).reshape(b * n, t, self.width)
        z = self.temporal(z)
        attention = self.pool_score(z).softmax(dim=1)
        pooled = (z * attention).sum(dim=1)
        z = self.pool_combine(torch.cat([z[:, -1], pooled], dim=-1)).reshape(b, n, self.width)
        context = self.market_encoder(market)
        modulation = 1 + .5 * self.market_modulation(context).tanh()
        z = z * modulation[:, None, :] + context[:, None, :]
        z = torch.where(available[..., None], z, torch.zeros_like(z))
        if self.spatial is not None:
            z = self.spatial(z, src_key_padding_mask=~available)
        z = self.output_norm(z)
        return {
            "return_z": self.return_head(z).squeeze(-1).masked_fill(~available, 0),
            "direction_logit": self.direction_head(z).squeeze(-1).masked_fill(~available, 0),
        }
