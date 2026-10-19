import type { Config, Context } from "@netlify/functions";
import { getSessionUser } from "../lib/auth.js";
import { json } from "../lib/http.js";

type FetchResult = { ok: boolean; status: number; data: any; cached?: boolean; stale?: boolean; upstreamStatus?: number };
type CacheEntry = { result: FetchResult; expiresAt: number; staleUntil: number };
type RuntimeCache = { cache: Map<string, CacheEntry>; inflight: Map<string, Promise<FetchResult>>; cooldown: Map<string, number> };

const runtimeRoot = globalThis as typeof globalThis & { __liveMarketR362?: RuntimeCache };
const runtime: RuntimeCache = runtimeRoot.__liveMarketR362 || (runtimeRoot.__liveMarketR362 = {
  cache: new Map(), inflight: new Map(), cooldown: new Map(),
});

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function isoFromUnixSeconds(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? new Date(n * 1_000).toISOString() : null;
}
function bcbDateToIso(value: unknown) {
  const s = String(value || "");
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (s || null);
}
function pctChange(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

async function cachedJson(
  key: string,
  url: string,
  headers: Record<string, string> = {},
  { ttlMs = 300_000, staleMs = 3_600_000, cooldownKey = key }: { ttlMs?: number; staleMs?: number; cooldownKey?: string } = {},
): Promise<FetchResult> {
  const now = Date.now();
  const cached = runtime.cache.get(key);
  if (cached && cached.expiresAt > now) return { ...cached.result, cached: true };
  if ((runtime.cooldown.get(cooldownKey) || 0) > now) {
    if (cached && cached.staleUntil > now) return { ...cached.result, cached: true, stale: true };
    return { ok: false, status: 429, data: null, cached: true, stale: true };
  }
  const existing = runtime.inflight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<FetchResult> => {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        const status = response.status;
        if (status === 429) runtime.cooldown.set(cooldownKey, Date.now() + 5 * 60_000);
        else if (status === 403) runtime.cooldown.set(cooldownKey, Date.now() + 6 * 60 * 60_000);
        else if (status >= 500 || status === 0) runtime.cooldown.set(cooldownKey, Date.now() + 60_000);
        if (cached && cached.staleUntil > Date.now()) return { ...cached.result, cached: true, stale: true, upstreamStatus: status };
        return { ok: false, status, data: null };
      }
      const result: FetchResult = { ok: true, status: response.status, data: await response.json() };
      runtime.cache.set(key, { result, expiresAt: Date.now() + ttlMs, staleUntil: Date.now() + Math.max(staleMs, ttlMs) });
      runtime.cooldown.delete(cooldownKey);
      return result;
    } catch {
      runtime.cooldown.set(cooldownKey, Date.now() + 60_000);
      if (cached && cached.staleUntil > Date.now()) return { ...cached.result, cached: true, stale: true, upstreamStatus: 0 };
      return { ok: false, status: 0, data: null };
    } finally {
      runtime.inflight.delete(key);
    }
  })();
  runtime.inflight.set(key, promise);
  return promise;
}

function marketSessions(now = new Date()) {
  const defs = [
    { label: "B3", timeZone: "America/Sao_Paulo", start: 10, end: 17, note: "ações · janela regular" },
    { label: "Nova York", timeZone: "America/New_York", start: 9.5, end: 16, note: "NYSE/Nasdaq · janela regular" },
    { label: "Londres", timeZone: "Europe/London", start: 8, end: 16.5, note: "janela regular" },
    { label: "Tóquio", timeZone: "Asia/Tokyo", start: 9, end: 15.5, note: "janela regular" },
  ];
  return defs.map((d) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: d.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
    const hour = Number(get("hour")) + Number(get("minute")) / 60;
    const weekday = get("weekday");
    return { label: d.label, open: !["Sat", "Sun"].includes(weekday) && hour >= d.start && hour < d.end, localTime: `${get("hour")}:${get("minute")}`, note: d.note };
  });
}

function brapiStockItem(symbol: string, row: any, requestedAt: string, source = "brapi.dev") {
  const envelope = row?.data ?? row;
  const value = num(envelope?.regularMarketPrice);
  return {
    key: symbol, symbol, label: envelope?.shortName || envelope?.longName || symbol, subtitle: "B3",
    value, changePct: num(envelope?.regularMarketChangePercent), format: "currency", currency: "BRL", group: "br",
    source, asOf: envelope?.regularMarketTime || requestedAt, available: value != null,
  };
}

async function brapiSingleQuote(symbol: string, token: string, useToken = true) {
  const headers = useToken && token ? { Authorization: `Bearer ${token}` } : {};
  const key = `brapi:quote:${symbol}:${useToken && token ? "auth" : "sandbox"}`;
  const res = await cachedJson(key, `https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`, headers, {
    ttlMs: 10 * 60_000, staleMs: 60 * 60_000, cooldownKey: useToken ? "brapi:auth" : "brapi:sandbox",
  });
  return { res, row: res.data?.results?.[0] };
}

function twelveRows(payload: any, symbols: string[]) {
  if (!payload || typeof payload !== "object") return {} as Record<string, any>;
  if (symbols.length === 1 && payload.symbol) return { [symbols[0]]: payload };
  return payload as Record<string, any>;
}

async function fxFromFrankfurter() {
  const targets = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "DKK", "NOK", "SEK"];
  const from = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  const res = await cachedJson(
    "fx:frankfurter:brl",
    `https://api.frankfurter.dev/v2/rates?base=BRL&quotes=${targets.join(",")}&from=${from}`,
    {}, { ttlMs: 60 * 60_000, staleMs: 24 * 60 * 60_000, cooldownKey: "frankfurter" },
  );
  const rows = Array.isArray(res.data) ? res.data : [];
  const out: Record<string, { value: number | null; previous: number | null; date: string | null }> = {};
  for (const code of targets) {
    const series = rows.filter((x: any) => String(x?.quote || "").toUpperCase() === code && num(x?.rate) != null)
      .sort((a: any, b: any) => String(a?.date || "").localeCompare(String(b?.date || "")));
    const last = series.at(-1), prev = series.at(-2);
    const lastRate = num(last?.rate), prevRate = num(prev?.rate);
    out[code] = {
      value: lastRate && lastRate !== 0 ? 1 / lastRate : null,
      previous: prevRate && prevRate !== 0 ? 1 / prevRate : null,
      date: last?.date || null,
    };
  }
  return { res, values: out };
}

async function cryptoFromCoinGecko() {
  const res = await cachedJson(
    "crypto:coingecko:btc-eth-brl",
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=brl&include_24hr_change=true&include_last_updated_at=true",
    { accept: "application/json", "user-agent": "PlataformaInvestimentos-R36.2" },
    { ttlMs: 5 * 60_000, staleMs: 60 * 60_000, cooldownKey: "coingecko" },
  );
  return res;
}

async function macroFromBcb() {
  const series = [
    { key: "SELIC", symbol: "selic", label: "Selic", subtitle: "taxa efetiva anualizada", code: 1178, transform: (v: number) => v },
    { key: "CDI", symbol: "cdi", label: "CDI", subtitle: "taxa anualizada estimada", code: 12, transform: (v: number) => v <= 1 ? (Math.pow(1 + v / 100, 252) - 1) * 100 : v },
    { key: "IPCA12M", symbol: "ipca12m", label: "IPCA 12m", subtitle: "acumulado em 12 meses", code: 13522, transform: (v: number) => v },
  ];
  const results = [] as any[];
  for (const cfg of series) {
    const res = await cachedJson(
      `bcb:sgs:${cfg.code}`,
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cfg.code}/dados/ultimos/2?formato=json`,
      {}, { ttlMs: 6 * 60 * 60_000, staleMs: 72 * 60 * 60_000, cooldownKey: `bcb:${cfg.code}` },
    );
    const rows = Array.isArray(res.data) ? res.data : [];
    const row = rows.at(-1);
    const raw = num(row?.valor);
    results.push({ cfg, res, value: raw == null ? null : cfg.transform(raw), asOf: bcbDateToIso(row?.data) });
  }
  return results;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);

  const brapiToken = Netlify.env.get("BRAPI_TOKEN") || "";
  const globalKey = Netlify.env.get("TWELVE_DATA_API_KEY") || "";
  const requestedAt = new Date().toISOString();
  const requestedSymbol = new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase() || "";

  if (requestedSymbol) {
    if (!/^[A-Z0-9.^=_-]{1,24}$/.test(requestedSymbol)) return json({ error: "Símbolo inválido para pesquisa." }, 400);
    const sandboxSymbols = new Set(["PETR4", "VALE3", "ITUB4", "MGLU3"]);
    const { res, row } = await brapiSingleQuote(requestedSymbol, brapiToken, !sandboxSymbols.has(requestedSymbol));
    const brItem = brapiStockItem(requestedSymbol, row, res.data?.requestedAt || requestedAt);
    if (res.ok && brItem.value != null) return json({ requestedAt, item: brItem, source: "brapi.dev", cached: Boolean(res.cached), stale: Boolean(res.stale) });
    if (globalKey) {
      const global = await cachedJson(
        `twelve:search:${requestedSymbol}`,
        `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(requestedSymbol)}`,
        { Authorization: `apikey ${globalKey}` },
        { ttlMs: 10 * 60_000, staleMs: 60 * 60_000, cooldownKey: "twelve" },
      );
      const rowGlobal = global.data;
      const close = num(rowGlobal?.close ?? rowGlobal?.price);
      if (global.ok && close != null) return json({ requestedAt, item: {
        key: requestedSymbol, symbol: requestedSymbol, label: rowGlobal?.name || requestedSymbol,
        subtitle: `${rowGlobal?.exchange || "Mercado global"}`, value: close, changePct: num(rowGlobal?.percent_change),
        format: "currency", currency: rowGlobal?.currency || "USD", group: "global", source: "Twelve Data",
        asOf: rowGlobal?.timestamp ? isoFromUnixSeconds(rowGlobal.timestamp) : (rowGlobal?.datetime || requestedAt),
        marketOpen: typeof rowGlobal?.is_market_open === "boolean" ? rowGlobal.is_market_open : null, available: true,
      }, source: "Twelve Data", cached: Boolean(global.cached), stale: Boolean(global.stale) });
    }
    return json({ error: "Ativo não encontrado nas fontes conectadas ou indisponível no plano atual." }, 404);
  }

  const items: any[] = [];
  const failures: any[] = [];

  // brapi Free: uma requisição simultânea. O IBOV usa token; as quatro ações de sandbox não consomem a cota autenticada.
  const ibovQuote = brapiToken ? await brapiSingleQuote("^BVSP", brapiToken, true) : { res: { ok: false, status: 401, data: null } as FetchResult, row: null };
  const ibov = brapiStockItem("IBOV", ibovQuote.row, ibovQuote.res.data?.requestedAt || requestedAt);
  ibov.symbol = "^BVSP"; ibov.label = "Ibovespa"; ibov.subtitle = "índice B3"; ibov.format = "index";
  ibov.available = Boolean(ibovQuote.res.ok && ibov.value != null);
  items.push(ibov);
  if (!ibovQuote.res.ok) failures.push({ name: "Ibovespa", status: ibovQuote.res.status });

  const b3Symbols = ["PETR4", "VALE3", "ITUB4", "MGLU3"];
  const b3Quotes: any[] = [];
  for (const symbol of b3Symbols) b3Quotes.push(await brapiSingleQuote(symbol, brapiToken, false));
  for (let i = 0; i < b3Symbols.length; i += 1) {
    const { res, row } = b3Quotes[i];
    const item = brapiStockItem(b3Symbols[i], row, res.data?.requestedAt || requestedAt, "brapi.dev · sandbox");
    item.available = Boolean(res.ok && item.value != null);
    items.push(item);
  }
  if (b3Quotes.some((x) => !x.res.ok)) failures.push({ name: "Ações B3 do desk", status: Math.max(...b3Quotes.map((x) => x.res.status || 0)) });

  const fx = await fxFromFrankfurter();
  const fxLabels: Record<string, string> = { USD: "Dólar americano", EUR: "Euro", GBP: "Libra esterlina", JPY: "Iene japonês", CHF: "Franco suíço", CAD: "Dólar canadense", AUD: "Dólar australiano", DKK: "Coroa dinamarquesa", NOK: "Coroa norueguesa", SEK: "Coroa sueca" };
  for (const code of Object.keys(fxLabels)) {
    const row = fx.values[code];
    items.push({
      key: `${code}-BRL`, symbol: `${code}-BRL`, label: fxLabels[code], subtitle: `${code}/BRL · referência diária`,
      value: row?.value ?? null, changePct: pctChange(row?.value ?? null, row?.previous ?? null), format: "number", group: "fx",
      source: "Frankfurter · fontes oficiais", asOf: row?.date || null, available: Boolean(fx.res.ok && row?.value != null),
    });
  }
  if (!fx.res.ok) failures.push({ name: "Câmbio", status: fx.res.status });

  const cryptoRes = await cryptoFromCoinGecko();
  const cryptoCfg = [{ key: "BTC", id: "bitcoin", label: "Bitcoin" }, { key: "ETH", id: "ethereum", label: "Ethereum" }];
  for (const cfg of cryptoCfg) {
    const row = cryptoRes.data?.[cfg.id];
    const value = num(row?.brl);
    items.push({
      key: cfg.key, symbol: cfg.key, label: cfg.label, subtitle: `${cfg.key}/BRL · 24h`, value,
      changePct: num(row?.brl_24h_change), format: "currency", currency: "BRL", group: "crypto", source: "CoinGecko",
      asOf: isoFromUnixSeconds(row?.last_updated_at) || null, available: Boolean(cryptoRes.ok && value != null),
    });
  }
  if (!cryptoRes.ok) failures.push({ name: "Cripto", status: cryptoRes.status });

  const macroRows = await macroFromBcb();
  for (const row of macroRows) {
    items.push({
      key: row.cfg.key, symbol: row.cfg.symbol, label: row.cfg.label, subtitle: row.cfg.subtitle,
      value: row.value, changePct: null, format: "percent", group: "macro", source: "Banco Central do Brasil · SGS",
      asOf: row.asOf, available: Boolean(row.res.ok && row.value != null),
    });
  }
  if (macroRows.some((x) => !x.res.ok)) failures.push({ name: "Macro", status: Math.max(...macroRows.map((x) => x.res.status || 0)) });

  const globalCfg: Record<string, { label: string; subtitle: string; group: string }> = {
    SPY: { label: "S&P 500", subtitle: "SPY · proxy ETF", group: "us" },
    QQQ: { label: "Nasdaq 100", subtitle: "QQQ · proxy ETF", group: "us" },
    DIA: { label: "Dow Jones", subtitle: "DIA · proxy ETF", group: "us" },
    FEZ: { label: "Europa", subtitle: "FEZ · Euro Stoxx 50 proxy", group: "global" },
    EWJ: { label: "Japão", subtitle: "EWJ · MSCI Japan proxy", group: "global" },
    FXI: { label: "China", subtitle: "FXI · large caps proxy", group: "global" },
    GLD: { label: "Ouro", subtitle: "GLD · proxy ETF", group: "commodity" },
    USO: { label: "Petróleo", subtitle: "USO · proxy ETF de petróleo", group: "commodity" },
    SLV: { label: "Prata", subtitle: "SLV · proxy ETF", group: "commodity" },
    CPER: { label: "Cobre", subtitle: "CPER · proxy ETF", group: "commodity" },
    SHY: { label: "Treasury curto prazo", subtitle: "SHY · ETF 1–3 anos", group: "rates" },
    IEF: { label: "Treasury médio prazo", subtitle: "IEF · ETF 7–10 anos", group: "rates" },
    TLT: { label: "Treasury longo prazo", subtitle: "TLT · ETF 20+ anos", group: "rates" },
  };
  const allGlobalSymbols = Object.keys(globalCfg);
  // O Basic do Twelve Data permite 8 créditos/min. Usamos 7 no desk e preservamos 1 crédito/min para pesquisa ou gráfico sob demanda.
  const requestedGlobalSymbols = ["SPY", "QQQ", "FEZ", "EWJ", "FXI", "GLD", "TLT"];
  const globalRes = globalKey ? await cachedJson(
    "twelve:desk:core8",
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(requestedGlobalSymbols.join(","))}`,
    { Authorization: `apikey ${globalKey}` },
    { ttlMs: 10 * 60_000, staleMs: 60 * 60_000, cooldownKey: "twelve" },
  ) : { ok: false, status: 0, data: null } as FetchResult;
  const globalRows = twelveRows(globalRes.data, requestedGlobalSymbols);
  for (const symbol of allGlobalSymbols) {
    const row = globalRows[symbol];
    const cfg = globalCfg[symbol];
    const close = num(row?.close ?? row?.price);
    const requestedThisRound = requestedGlobalSymbols.includes(symbol);
    items.push({
      key: symbol, symbol, label: cfg.label, subtitle: cfg.subtitle, value: close, changePct: num(row?.percent_change),
      format: "currency", currency: row?.currency || "USD", group: cfg.group, proxy: true,
      source: requestedThisRound ? "Twelve Data" : "Twelve Data · fora da cota essencial",
      asOf: row?.timestamp ? isoFromUnixSeconds(row.timestamp) : (row?.datetime || null),
      marketOpen: typeof row?.is_market_open === "boolean" ? row.is_market_open : null,
      available: Boolean(globalKey && requestedThisRound && globalRes.ok && close != null),
    });
  }
  if (globalKey && !globalRes.ok) failures.push({ name: "Mercados globais", status: globalRes.status });

  return json({
    requestedAt,
    source: "brapi.dev + Frankfurter + CoinGecko + Banco Central do Brasil + Twelve Data",
    providerStatus: {
      brapiTokenConfigured: Boolean(brapiToken), globalProviderConfigured: Boolean(globalKey),
      cachePolicy: "5–10 min mercado; 1h câmbio; 6h macro; stale-on-error e cooldown em 429/403",
    },
    sessions: marketSessions(), items, failures,
    dataPolicy: "R36.2 prioriza os limites gratuitos. B3 autenticada é serializada; as quatro ações de sandbox usam acesso sem token. Câmbio usa referência diária Frankfurter, cripto usa CoinGecko e macro usa SGS/BCB. O Twelve Data consulta somente 7 proxies essenciais por rodada e preserva 1 crédito/min para consultas sob demanda para respeitar o Basic; referências secundárias podem aparecer como —. Em falha/limite, dados válidos em cache podem ser mantidos temporariamente, nunca convertidos para zero. A tela é informativa e não é feed tick-by-tick.",
  });
};

export const config: Config = { path: "/api/live-market" };
