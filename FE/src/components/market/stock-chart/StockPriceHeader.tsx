import type { PriceTone } from "./formatters";
import { formatChangeRate, formatWon } from "./formatters";

// The page header above already shows the name and current price, so the chart
// header only reports the selected range's performance.
type StockPriceHeaderProps = {
  changeAmount: number;
  changeRate: number;
  performanceLabel: string;
  tone: PriceTone;
};

function getMarker(tone: PriceTone) {
  if (tone === "up") {
    return "▲";
  }

  if (tone === "down") {
    return "▼";
  }

  return "";
}

export function StockPriceHeader({ changeAmount, changeRate, performanceLabel, tone }: StockPriceHeaderProps) {
  const marker = getMarker(tone);

  return (
    <header className="stock-price-header">
      <p className={`stock-price-header__change stock-price-header__change--${tone}`}>
        <span>
          {marker ? `${marker} ` : ""}
          {formatWon(Math.abs(changeAmount))} ({formatChangeRate(changeRate)})
        </span>
        <small>{performanceLabel}</small>
      </p>
    </header>
  );
}
