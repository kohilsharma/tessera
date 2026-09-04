// #88: the indicators are ours and they are arithmetic. No I/O lives here — every
// function takes a series of closes, oldest first, and returns a number. That is what
// makes them deterministic, free, and testable against published fixtures rather than
// against whatever a vendor happened to return today (spec §4).
//
// Feed these `adjClose`, never `close`. Adjusted closes account for splits and
// dividends; over raw closes a 2-for-1 split reads as a 50% crash and every indicator
// downstream inherits the lie. ADR-0036 records that the provider supplies both.
//
// Every function answers `null` rather than a number it cannot stand behind — too short
// a series, or a series with a hole in it. A displayed indicator is a claim, and NaN
// silently rendered as a number is the failure worth engineering against.

// Wilder's original period, and still the convention every published RSI uses.
export const RSI_PERIOD = 14;
// US equity trading days in a year, the standard annualisation factor.
export const TRADING_DAYS_PER_YEAR = 252;

function usableSeries(closes: number[]): boolean {
  return closes.length > 0 && closes.every((close) => Number.isFinite(close));
}

function usablePeriod(period: number): boolean {
  return Number.isInteger(period) && period > 0;
}

export function simpleMovingAverage(closes: number[], period: number): number | null {
  if (!usablePeriod(period) || !usableSeries(closes) || closes.length < period) return null;
  const window = closes.slice(-period);
  return window.reduce((sum, close) => sum + close, 0) / period;
}

export function relativeStrengthIndex(closes: number[], period: number = RSI_PERIOD): number | null {
  // One more close than the period: n closes give n-1 changes, and the first average
  // is taken over `period` of them.
  if (!usablePeriod(period) || !usableSeries(closes) || closes.length < period + 1) return null;

  const changes = closes.slice(1).map((close, index) => close - closes[index]);
  const gainAt = (index: number) => Math.max(changes[index], 0);
  const lossAt = (index: number) => Math.max(-changes[index], 0);

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 0; index < period; index++) {
    averageGain += gainAt(index) / period;
    averageLoss += lossAt(index) / period;
  }
  // Wilder's smoothing, which is what makes this *the* RSI rather than a moving average
  // of gains: each step keeps period-1 parts of the old average and one part of the new
  // change, so early history decays but never drops out of the window entirely.
  for (let index = period; index < changes.length; index++) {
    averageGain = (averageGain * (period - 1) + gainAt(index)) / period;
    averageLoss = (averageLoss * (period - 1) + lossAt(index)) / period;
  }

  // A motionless price is neither overbought nor oversold. The usual shortcut —
  // "no losses means 100" — would call a flat series extremely overbought, so the
  // no-movement case is answered before it.
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

// Annualised standard deviation of daily log returns, as a percent. Log returns because
// they compose additively over time, which is what makes scaling by sqrt(252) valid;
// the sample deviation (n-1) because a price history is a sample, not a population.
export function volatility(closes: number[]): number | null {
  // Two returns are the fewest that have a spread between them, so three closes.
  if (!usableSeries(closes) || closes.length < 3 || closes.some((close) => close <= 0)) return null;

  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}
