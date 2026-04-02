import YahooFinance from "yahoo-finance2";
import { WebClient, LogLevel } from "@slack/web-api";
import { FINVIZ_SYMBOLS, KR_SYMBOLS, JP_SYMBOLS, SLACK_CHANNEL_ID, finvizURL, naverURL, kabutanURL } from "./define";

const yahooFinance = new YahooFinance({ suppressNotices: ["ripHistorical"] });

const RSI_PERIOD = 14;
const SIGNAL_PERIOD = 9;
const MA_SHORT = 20;
const MA_MID = 50;
const MA_LONG = 200;
const RSI_THRESHOLD = 30; // Alert when RSI(14) ≤ 35 (oversold)

const client = new WebClient(process.env.SLACK_BOT_TOKEN, {
  logLevel: LogLevel.ERROR,
});

type Currency = "USD" | "KRW" | "JPY";

interface StockIndicators {
  symbol: string;      // display label (e.g. "TSLA" or "005930")
  chartUrl: string;    // Finviz or Naver Finance URL
  currency: Currency;
  price: number;
  rsi: number;
  signal: number;
  ma5: number;
  ma10: number;
  ma20: number;
  ma50: number;
  ma200: number;
  companyName?: string;
  sector?: string;
  industry?: string;
}

/** Format price based on currency */
function formatPrice(price: number, currency: Currency): string {
  if (currency === "KRW") {
    return `₩${Math.round(price).toLocaleString("en-US")}`;
  }
  if (currency === "JPY") {
    return `¥${Math.round(price).toLocaleString("en-US")}`;
  }
  return `$${price.toFixed(2)}`;
}

/**
 * Calculate RSI(14), Signal(9), MA5, MA10, MA20, MA50, MA200 from closing price series
 */
function calculateIndicators(closes: number[]): Omit<StockIndicators, "symbol" | "chartUrl" | "currency"> | null {
  if (closes.length < Math.max(RSI_PERIOD + SIGNAL_PERIOD, MA_LONG)) return null;

  // --- RSI(14) + Signal(9) ---
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? Math.abs(c) : 0));
  const toRSI = (ag: number, al: number) =>
    al === 0 ? 100 : 100 - 100 / (1 + ag / al);

  let avgGain = gains.slice(0, RSI_PERIOD).reduce((a, b) => a + b, 0) / RSI_PERIOD;
  let avgLoss = losses.slice(0, RSI_PERIOD).reduce((a, b) => a + b, 0) / RSI_PERIOD;

  const rsiSeries: number[] = [toRSI(avgGain, avgLoss)];
  for (let i = RSI_PERIOD; i < changes.length; i++) {
    avgGain = (avgGain * (RSI_PERIOD - 1) + gains[i]) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + losses[i]) / RSI_PERIOD;
    rsiSeries.push(toRSI(avgGain, avgLoss));
  }
  if (rsiSeries.length < SIGNAL_PERIOD) return null;

  const k = 2 / (SIGNAL_PERIOD + 1);
  let signal = rsiSeries.slice(0, SIGNAL_PERIOD).reduce((a, b) => a + b, 0) / SIGNAL_PERIOD;
  for (let i = SIGNAL_PERIOD; i < rsiSeries.length; i++) {
    signal = rsiSeries[i] * k + signal * (1 - k);
  }

  // --- MA5 / MA10 / MA20 / MA50 / MA200 (SMA) ---
  const sma = (n: number) =>
    closes.slice(-n).reduce((a, b) => a + b, 0) / n;

  return {
    price: closes[closes.length - 1],
    rsi: rsiSeries[rsiSeries.length - 1],
    signal,
    ma5: sma(5),
    ma10: sma(10),
    ma20: sma(MA_SHORT),
    ma50: sma(MA_MID),
    ma200: sma(MA_LONG),
  };
}

/**
 * Fetch price data and calculate all indicators via Yahoo Finance
 */
async function fetchIndicators(
  yahooSymbol: string
): Promise<Omit<StockIndicators, "symbol" | "chartUrl" | "currency"> | null> {
  const period1 = new Date();
  period1.setDate(period1.getDate() - 400); // ~280 trading days — covers MA200 + stable Wilder's RSI

  const result = await yahooFinance.chart(yahooSymbol, {
    period1,
    interval: "1d",
  });

  const quotes = result?.quotes;
  if (!quotes || quotes.length < Math.max(RSI_PERIOD + SIGNAL_PERIOD, MA_LONG) + 1) {
    console.warn(`Not enough data for ${yahooSymbol} (got ${quotes?.length ?? 0} rows)`);
    return null;
  }

  const closes = quotes.map((q) => q.close).filter((c): c is number => c !== null);
  return calculateIndicators(closes);
}

/** Fetch company name and sector from Yahoo Finance quoteSummary */
async function fetchCompanyInfo(yahooSymbol: string): Promise<{ companyName?: string; sector?: string; industry?: string }> {
  try {
    const summary = await yahooFinance.quoteSummary(yahooSymbol, {
      modules: ["assetProfile", "price"],
    });
    const profile = summary.assetProfile as { sector?: string; industry?: string } | undefined;
    return {
      companyName: summary.price?.longName ?? summary.price?.shortName ?? undefined,
      sector: profile?.sector,
      industry: profile?.industry,
    };
  } catch {
    return {};
  }
}

/** Build a formatted stock list string sorted by RSI ascending */
function buildStockLines(stocks: StockIndicators[]): string {
  return [...stocks]
    .sort((a, b) => a.rsi - b.rsi)
    .map((s) => {
      const rsiArrow = s.rsi < s.signal ? ":arrow_down_small:" : ":arrow_up_small:";
      const fp = formatPrice(s.price, s.currency);
      const ma = (label: string, maVal: number) =>
        `${label} ${s.price >= maVal ? ":large_green_circle:" : ":red_circle:"}`;
      const maLine =
        `${ma("MA5", s.ma5)}  ${ma("MA10", s.ma10)}  ${ma("MA20", s.ma20)}  ${ma("MA50", s.ma50)}  ${ma("MA200", s.ma200)}`;
      const metaLine = [s.sector, s.industry].filter(Boolean).map((v) => `\`${v}\``).join(" › ");
      const titleLine = s.companyName
        ? `• *<${s.chartUrl}|${s.symbol}>*  _${s.companyName}_${metaLine ? `  ${metaLine}` : ""}  Price \`${fp}\``
        : `• *<${s.chartUrl}|${s.symbol}>*  Price \`${fp}\``;
      return (
        `${titleLine}\n` +
        `  RSI(14) \`${s.rsi.toFixed(2)}\`  Signal(9) \`${s.signal.toFixed(2)}\` ${rsiArrow}\n` +
        `  ${maLine}`
      );
    })
    .join("\n\n");
}

/**
 * Send Slack alert: one header message + US thread + KOSPI thread + Nikkei thread
 */
async function sendSlackAlert(
  usStocks: StockIndicators[],
  krStocks: StockIndicators[],
  jpStocks: StockIndicators[]
): Promise<void> {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC+9
  const dateStr = now.toISOString().replace("T", " ").slice(0, 16);

  // 1. Post header message to the channel
  const headerMessage =
    `*:rotating_light: RSI Oversold Alert  (RSI(14) ≤ ${RSI_THRESHOLD})*\n` +
    `_${dateStr} KST_  •  :us: US ${usStocks.length}개  :kr: KOSPI ${krStocks.length}개  :flag-jp: Nikkei ${jpStocks.length}개\n\n` +
    `_:large_green_circle: price above MA  :red_circle: price below MA_`;

  const headerResult = await client.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: headerMessage,
    mrkdwn: true,
  });

  const threadTs = headerResult.ts;

  // 2. Post US stocks as a single thread reply
  if (usStocks.length > 0) {
    await client.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: `*:us: US — ${usStocks.length} stock(s)*\n\n${buildStockLines(usStocks)}`,
      mrkdwn: true,
      thread_ts: threadTs,
    });
  }

  // 3. Post KOSPI stocks as a single thread reply
  if (krStocks.length > 0) {
    await client.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: `*:kr: KOSPI — ${krStocks.length} stock(s)*\n\n${buildStockLines(krStocks)}`,
      mrkdwn: true,
      thread_ts: threadTs,
    });
  }

  // 4. Post Nikkei 225 stocks as a single thread reply
  if (jpStocks.length > 0) {
    await client.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: `*:flag-jp: Nikkei 225 — ${jpStocks.length} stock(s)*\n\n${buildStockLines(jpStocks)}`,
      mrkdwn: true,
      thread_ts: threadTs,
    });
  }

  console.log(`Slack alert sent: US ${usStocks.length}, KOSPI ${krStocks.length}, Nikkei ${jpStocks.length} stock(s).`);
}

/**
 * Check a list of symbols and collect oversold stocks
 */
async function collectOversold(
  symbols: string[],
  toYahooSymbol: (s: string) => string,
  toChartUrl: (s: string) => string,
  currency: Currency
): Promise<StockIndicators[]> {
  const result: StockIndicators[] = [];
  const CHUNK_SIZE = 5;

  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + CHUNK_SIZE);
    const promises = chunk.map(async (symbol) => {
      const yahooSymbol = toYahooSymbol(symbol);
      try {
        const ind = await fetchIndicators(yahooSymbol);
        if (ind === null) return null;

        console.log(
          `${symbol}: ${formatPrice(ind.price, currency)}  RSI(14)=${ind.rsi.toFixed(2)}  ` +
          `Signal(9)=${ind.signal.toFixed(2)}  MA20=${ind.ma20.toFixed(0)}  MA50=${ind.ma50.toFixed(0)}  MA200=${ind.ma200.toFixed(0)}`
        );

        if (ind.rsi <= RSI_THRESHOLD) {
          const info = await fetchCompanyInfo(yahooSymbol);
          return { symbol, chartUrl: toChartUrl(symbol), currency, ...ind, ...info };
        }
      } catch (error) {
        console.error(`Error processing ${symbol}: ${error}`);
      }
      return null;
    });

    const chunkResults = await Promise.all(promises);
    for (const res of chunkResults) {
      if (res) result.push(res);
    }
  }

  return result;
}

/**
 * Main: check RSI(14)(9) + MA20/50/200 for US, KOSPI, and Nikkei 225 stocks
 * Optional argv[2]: "us" | "kr" | "jp" — run only that market
 */
async function checkRSIAndAlert(): Promise<void> {
  const target = (process.argv[2] ?? "all").toLowerCase();
  const runUs = target === "all" || target === "us";
  const runKr = target === "all" || target === "kr";
  const runJp = target === "all" || target === "jp";

  const markets = [
    runUs ? `${FINVIZ_SYMBOLS.length} US` : null,
    runKr ? `${KR_SYMBOLS.length} KOSPI` : null,
    runJp ? `${JP_SYMBOLS.length} Nikkei 225` : null,
  ].filter(Boolean).join(" + ");

  console.log(
    `Checking RSI(${RSI_PERIOD})(${SIGNAL_PERIOD}) + MA${MA_SHORT}/MA${MA_MID}/MA${MA_LONG} ` +
    `for ${markets} symbols...`
  );

  // US stocks (Finviz symbols, USD)
  const usAlerts = runUs
    ? await collectOversold(FINVIZ_SYMBOLS, (s) => s, (s) => finvizURL(s), "USD")
    : [];

  // KOSPI stocks (code + .KS for Yahoo Finance, KRW)
  if (runKr) console.log("\n--- KOSPI ---");
  const krAlerts = runKr
    ? await collectOversold(KR_SYMBOLS, (s) => `${s}.KS`, (s) => naverURL(s), "KRW")
    : [];

  // Nikkei 225 stocks (code + .T for Yahoo Finance, JPY)
  if (runJp) console.log("\n--- Nikkei 225 ---");
  const jpAlerts = runJp
    ? await collectOversold(JP_SYMBOLS, (s) => `${s}.T`, (s) => kabutanURL(s), "JPY")
    : [];

  // Send a single alert with collected markets as separate thread replies
  if (usAlerts.length > 0 || krAlerts.length > 0 || jpAlerts.length > 0) {
    await sendSlackAlert(usAlerts, krAlerts, jpAlerts);
  } else {
    console.log(`No stocks with RSI(14) ≤ ${RSI_THRESHOLD}. No alert sent.`);
  }
}

checkRSIAndAlert().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
