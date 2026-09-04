import { ChartLineUp, Sparkle, TrendDown, TrendUp } from "@phosphor-icons/react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MarketPanel as MarketPanelData, MarketRead } from "../api/client";
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
  read,
  onGenerateRead,
  generatingRead,
  readError,
}: {
  markets: MarketPanelData[] | null | undefined;
  status: "ready" | "empty" | "unavailable" | undefined;
  total: number | undefined;
  onRetry: () => void;
  retrying: boolean;
  read?: MarketRead;
  onGenerateRead: () => void;
  generatingRead: boolean;
  readError: Error | null;
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
      {read ? (
        <div className={styles.read}>
          <p className={styles.readLabel}>Generated read</p>
          <p>{read.read}</p>
          <p className={styles.source}>Sources: {read.citationDetails.map((citation) => <a key={citation.evidenceId} className="citation" href={`/articles/${citation.articleId}`} title={citation.title}>{citation.evidenceId} · {citation.publisherName}</a>)} · {read.provider} · <time dateTime={read.generatedAt}>{new Date(read.generatedAt).toLocaleString()}</time></p>
        </div>
      ) : status === "ready" && markets && markets.length > 0 ? (
        <div className={styles.readAction}>
          <button type="button" className="record-command" onClick={onGenerateRead} disabled={generatingRead}>
            <Sparkle aria-hidden="true" size={18} /> {generatingRead ? "Writing read…" : "Generate market read"}
          </button>
          {readError && <p className={styles.readError} role="alert">Could not generate the market read: {readError.message}</p>}
        </div>
      ) : null}
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
