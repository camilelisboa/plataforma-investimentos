import type { Config, Context } from "@netlify/functions";
import { getSessionUser } from "../lib/auth.js";
import { json } from "../lib/http.js";

type RangeKey = "1D" | "5D" | "1M" | "6M" | "1Y";
const RANGE: Record<RangeKey, { brRange: string; brInterval: string; tdInterval: string; outputsize: number }> = {
  "1D": { brRange: "1d", brInterval: "5m", tdInterval: "5min", outputsize: 110 },
  "5D": { brRange: "5d", brInterval: "30m", tdInterval: "30min", outputsize: 130 },
  "1M": { brRange: "1mo", brInterval: "1d", tdInterval: "1day", outputsize: 35 },
  "6M": { brRange: "6mo", brInterval: "1d", tdInterval: "1day", outputsize: 190 },
  "1Y": { brRange: "1y", brInterval: "1d", tdInterval: "1day", outputsize: 370 },
};

function decodeEntities(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function pickTag(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeEntities(m[1].trim()) : "";
}
async function getJson(url: string, headers: Record<string, string> = {}) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(9_000) });
    if (!r.ok) return { ok: false as const, status: r.status, data: null as any };
    return { ok: true as const, status: r.status, data: await r.json() as any };
  } catch {
    return { ok: false as const, status: 0, data: null as any };
  }
}
async function assetNews(symbol: string) {
  const aliases: Record<string, string> = { IBOV: "Ibovespa", "^BVSP": "Ibovespa", SPY: "S&P 500", QQQ: "Nasdaq 100", "USD-BRL": "dólar real", BTC: "Bitcoin", ETH: "Ethereum", GLD: "ouro", USO: "petróleo" };
  const query = aliases[symbol] || symbol;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} mercado investimentos`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 PlataformaInvestimentos/1.7" }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((m) => {
      const item = m[1];
      return { title: pickTag(item, "title"), url: pickTag(item, "link"), publishedAt: pickTag(item, "pubDate"), source: pickTag(item, "source") || "Google News" };
    }).filter((x) => x.title && x.url);
  } catch { return []; }
}
function normalizeSymbol(raw: string) {
  const s = raw.trim().toUpperCase();
  if (s === "IBOV") return "^BVSP";
  return s;
}
function tdSymbol(symbol: string) {
  if (symbol === "USD-BRL") return "USD/BRL";
  if (symbol === "EUR-BRL") return "EUR/BRL";
  if (symbol === "GBP-BRL") return "GBP/BRL";
  if (symbol === "JPY-BRL") return "JPY/BRL";
  if (symbol === "CHF-BRL") return "CHF/BRL";
  if (symbol === "CAD-BRL") return "CAD/BRL";
  if (symbol === "AUD-BRL") return "AUD/BRL";
  if (symbol === "BTC") return "BTC/BRL";
  if (symbol === "ETH") return "ETH/BRL";
  return symbol;
}
function isLikelyB3(symbol: string) {
  return symbol === "^BVSP" || /^[A-Z]{4}\d{1,2}$/.test(symbol);
}
function brapiPoints(payload: any) {
  const result = payload?.results?.[0];
  const data = result?.data ?? result;
  const rows = Array.isArray(data?.historicalDataPrice) ? data.historicalDataPrice : [];
  return rows.map((x: any) => ({
    time: Number.isFinite(Number(x?.date)) ? new Date(Number(x.date) * 1000).toISOString() : String(x?.date || ""),
    value: Number(x?.close ?? x?.adjustedClose), high: Number(x?.high), low: Number(x?.low), volume: Number(x?.volume),
  })).filter((x: any) => Number.isFinite(x.value) && x.time).sort((a: any, b: any) => String(a.time).localeCompare(String(b.time)));
}
function twelvePoints(payload: any) {
  const rows = Array.isArray(payload?.values) ? payload.values : [];
  return rows.map((x: any) => ({ time: String(x?.datetime || ""), value: Number(x?.close), high: Number(x?.high), low: Number(x?.low), volume: Number(x?.volume) }))
    .filter((x: any) => Number.isFinite(x.value) && x.time).reverse();
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);

  const url = new URL(req.url);
  const input = (url.searchParams.get("symbol") || "IBOV").trim().toUpperCase();
  const rangeInput = (url.searchParams.get("range") || "1D").toUpperCase() as RangeKey;
  const range = RANGE[rangeInput] ? rangeInput : "1D";
  if (!/^[A-Z0-9.^=_/-]{1,24}$/.test(input)) return json({ error: "Símbolo inválido." }, 400);

  const symbol = normalizeSymbol(input);
  const cfg = RANGE[range];
  const brapiToken = Netlify.env.get("BRAPI_TOKEN") || "";
  const globalKey = Netlify.env.get("TWELVE_DATA_API_KEY") || "";
  let points: any[] = [], source = "", providerNote = "";

  if (isLikelyB3(symbol)) {
    const headers = brapiToken ? { Authorization: `Bearer ${brapiToken}` } : {};
    const br = await getJson(`https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}&range=${cfg.brRange}&interval=${cfg.brInterval}&fundamental=false&dividends=false`, headers);
    if (br.ok) { points = brapiPoints(br.data); source = "brapi.dev"; }
  }

  if (points.length < 2 && globalKey) {
    const td = await getJson(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol(input))}&interval=${cfg.tdInterval}&outputsize=${cfg.outputsize}&order=DESC`, { Authorization: `apikey ${globalKey}` });
    if (td.ok) { points = twelvePoints(td.data); source = "Twelve Data"; }
  }

  if (!points.length) providerNote = globalKey || isLikelyB3(symbol)
    ? "O provedor conectado não devolveu histórico para este ativo/intervalo."
    : "Configure TWELVE_DATA_API_KEY para histórico de ativos globais, moedas e cripto.";

  const news = await assetNews(input);
  return json({ requestedAt: new Date().toISOString(), symbol: input, range, source: source || "indisponível", points, news, newsSource: "Google News RSS", providerNote });
};

export const config: Config = { path: "/api/live-detail" };
