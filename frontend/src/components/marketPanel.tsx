import { ChartLineUp, TrendDown, TrendUp } from "@phosphor-icons/react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MarketPanel as MarketPanelData } from "../api/client";
import { RolePanel } from "./primitives";
import { EmptyState, RetryableError } from "./uiStates";
import styles from "./marketPanel.module.css";

function value(value: number | null, suffix = "") {
  return value === null ? "Unavailable" : `${value.toFixed(2)}${suffix}`;
}

export function InvestorMarketPanel({
  markets,
  status,
  total,
  onRetry,
  retrying,
}: {
  markets: MarketPanelData[] | null | undefined;
  status: "ready" | "empty" | "unavailable" | undefined;
  total: number | undefined;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <RolePanel role="Investor">
      <div className={styles.heading}>
        <div>
          <h3>Market intelligence</h3>
          <p>Quotes and indicators from resolved organization Tickers.</p>
        </div>
        <ChartLineUp aria-hidden="true" size={24} weight="duotone" />
      </div>
      {status === "unavailable" ? (
        <RetryableError message="Market data could not be loaded from the provider." onRetry={onRetry} retrying={retrying} />
      ) : !markets || markets.length === 0 ? (
        <EmptyState><p>No market data for this Story. No resolved organization has usable market data yet.</p></EmptyState>
      ) : (
        <>
          <p className={styles.summary}>Showing {markets.length} of {Math.max(total ?? markets.length, markets.length)}</p>
          <ul className={styles.list}>
            {markets.map((market) => {
            const rising = market.quote.change >= 0;
            const change = `${rising ? "+" : "-"}$${Math.abs(market.quote.change).toFixed(2)} (${market.quote.changePercent >= 0 ? "+" : ""}${market.quote.changePercent.toFixed(2)}%)`;
            return (
              <li key={market.entity.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <div>
                    <span className={styles.entity}>{market.entity.canonicalName}</span>
                    <span className={styles.ticker}>{market.entity.ticker}</span>
                  </div>
                  <div className={rising ? styles.up : styles.down}>
                    {rising ? <TrendUp aria-hidden="true" size={18} /> : <TrendDown aria-hidden="true" size={18} />}
                    <strong>${market.quote.price.toFixed(2)}</strong>
                    <span>{change}</span>
                  </div>
                </div>
                <div className={styles.chart} role="img" aria-label={`${market.entity.ticker} adjusted closing price over the available series`}>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={market.series} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                      <XAxis dataKey="date" hide />
                      <YAxis domain={["auto", "auto"]} tickFormatter={(tick) => `$${Number(tick).toFixed(0)}`} width={52} />
                      <Tooltip />
                      <Line type="monotone" dataKey="adjClose" stroke={rising ? "var(--up)" : "var(--down)"} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <dl className={styles.readouts}>
                  <div><dt>50-day average</dt><dd>{value(market.indicators.sma50, "")}</dd></div>
                  <div><dt>RSI 14</dt><dd>{value(market.indicators.rsi14)}</dd></div>
                  <div><dt>Volatility</dt><dd>{value(market.indicators.volatility, "%")}</dd></div>
                </dl>
                <p className={styles.source}>Source: {market.quote.source}. As of <time dateTime={market.quote.asOf}>{new Date(market.quote.asOf).toLocaleString()}</time>.</p>
              </li>
            );
            })}
          </ul>
        </>
      )}
    </RolePanel>
  );
}
