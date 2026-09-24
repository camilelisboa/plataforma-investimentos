import type { Config, Context } from "@netlify/functions";
import { getSessionUser } from "../lib/auth.js";
import { json } from "../lib/http.js";

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { ok: false as const, status: response.status, data: null as any };
    return { ok: true as const, status: response.status, data: await response.json() as any };
  } catch {
    return { ok: false as const, status: 0, data: null as any };
  }
}

function isoFromUnixSeconds(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1_000).toISOString();
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

function brapiStockItem(symbol: string, row: any, requestedAt: string) {
  const envelope = row?.data ?? row;
  return {
    key: symbol,
    symbol,
    label: envelope?.shortName || envelope?.longName || symbol,
    subtitle: "B3",
    value: num(envelope?.regularMarketPrice),
    changePct: num(envelope?.regularMarketChangePercent),
    format: "currency",
    currency: "BRL",
    group: "br",
    source: "brapi.dev",
    asOf: envelope?.regularMarketTime || requestedAt,
    available: num(envelope?.regularMarketPrice) != null,
  };
}

async function brapiSingleQuote(symbol: string, token: string) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await getJson(`https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`, headers);
  const row = res.data?.results?.[0];
  return { res, row };
}

function twelveRows(payload: any, symbols: string[]) {
  if (!payload || typeof payload !== "object") return {} as Record<string, any>;
  if (symbols.length === 1 && payload.symbol) return { [symbols[0]]: payload };
  return payload as Record<string, any>;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);

  const brapiToken = Netlify.env.get("BRAPI_TOKEN") || "";
  const globalKey = Netlify.env.get("TWELVE_DATA_API_KEY") || "";
  const requestedAt = new Date().toISOString();
  const brapiHeaders = brapiToken ? { Authorization: `Bearer ${brapiToken}` } : {};

  const requestedSymbol = new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase() || "";
  if (requestedSymbol) {
    if (!/^[A-Z0-9.^=_-]{1,24}$/.test(requestedSymbol)) return json({ error: "Símbolo inválido para pesquisa." }, 400);
    const { res, row } = await brapiSingleQuote(requestedSymbol, brapiToken);
    const brItem = brapiStockItem(requestedSymbol, row, res.data?.requestedAt || requestedAt);
    if (res.ok && brItem.value != null) return json({ requestedAt, item: brItem, source: "brapi.dev" });
    if (globalKey) {
      const global = await getJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(requestedSymbol)}`, { Authorization: `apikey ${globalKey}` });
      const rowGlobal = global.data;
      const close = num(rowGlobal?.close ?? rowGlobal?.price);
      if (global.ok && close != null) return json({ requestedAt, item: {
        key: requestedSymbol, symbol: requestedSymbol, label: rowGlobal?.name || requestedSymbol,
        subtitle: `${rowGlobal?.exchange || "Mercado global"}`, value: close, changePct: num(rowGlobal?.percent_change),
        format: "currency", currency: rowGlobal?.currency || "USD", group: "global", source: "Twelve Data",
        asOf: rowGlobal?.timestamp ? isoFromUnixSeconds(rowGlobal.timestamp) : (rowGlobal?.datetime || requestedAt),
        marketOpen: typeof rowGlobal?.is_market_open === "boolean" ? rowGlobal.is_market_open : null, available: true,
      }, source: "Twelve Data" });
    }
    return json({ error: "Ativo não encontrado nas fontes conectadas ou indisponível no plano atual." }, 404);
  }

  const b3Symbols = ["PETR4", "VALE3", "ITUB4", "MGLU3"];
  const globalSymbols = ["SPY", "QQQ", "DIA", "FEZ", "EWJ", "FXI", "GLD", "USO", "SLV", "CPER", "SHY", "IEF", "TLT"];

  const [ibovRes, currencyRes, cryptoRes, macroRes, b3Quotes, globalRes] = await Promise.all([
    getJson("https://brapi.dev/api/v2/stocks/quote?symbols=%5EBVSP", brapiHeaders),
    getJson("https://brapi.dev/api/v2/currency?currency=USD-BRL,EUR-BRL,GBP-BRL,JPY-BRL,CHF-BRL,CAD-BRL,AUD-BRL,DKK-BRL,NOK-BRL,SEK-BRL", brapiHeaders),
    getJson("https://brapi.dev/api/v2/crypto?coin=BTC,ETH&currency=BRL", brapiHeaders),
    getJson("https://brapi.dev/api/v2/macro/latest?symbols=selic,cdi,ipca12m", brapiHeaders),
    Promise.all(b3Symbols.map((symbol) => brapiSingleQuote(symbol, brapiToken))),
    globalKey
      ? getJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(globalSymbols.join(","))}`, { Authorization: `apikey ${globalKey}` })
      : Promise.resolve({ ok: false as const, status: 0, data: null as any }),
  ]);

  const items: any[] = [];

  const ibovEnvelope = ibovRes.data?.results?.[0];
  const ibov = ibovEnvelope?.data ?? ibovEnvelope;
  items.push({
    key: "IBOV", symbol: "^BVSP", label: "Ibovespa", subtitle: "índice B3",
    value: num(ibov?.regularMarketPrice), changePct: num(ibov?.regularMarketChangePercent), format: "index", group: "br",
    source: "brapi.dev", asOf: ibov?.regularMarketTime || ibovRes.data?.requestedAt || null,
    available: Boolean(ibovRes.ok && num(ibov?.regularMarketPrice) != null),
  });

  for (let i = 0; i < b3Symbols.length; i += 1) {
    const { res, row } = b3Quotes[i];
    const item = brapiStockItem(b3Symbols[i], row, res.data?.requestedAt || requestedAt);
    item.available = Boolean(res.ok && item.value != null);
    items.push(item);
  }

  const currencies = Array.isArray(currencyRes.data?.currency) ? currencyRes.data.currency : [];
  for (const [key, label] of [
    ["USD-BRL", "Dólar americano"], ["EUR-BRL", "Euro"], ["GBP-BRL", "Libra esterlina"], ["JPY-BRL", "Iene japonês"],
    ["CHF-BRL", "Franco suíço"], ["CAD-BRL", "Dólar canadense"], ["AUD-BRL", "Dólar australiano"],
    ["DKK-BRL", "Coroa dinamarquesa"], ["NOK-BRL", "Coroa norueguesa"], ["SEK-BRL", "Coroa sueca"],
  ] as const) {
    const [from, to] = key.split("-");
    const row = currencies.find((x: any) => String(x?.fromCurrency).toUpperCase() === from && String(x?.toCurrency).toUpperCase() === to);
    items.push({
      key, symbol: key, label, subtitle: `${from}/${to}`, value: num(row?.bidPrice), changePct: num(row?.percentageChange),
      format: "number", group: "fx", source: "brapi.dev / BCB", asOf: isoFromUnixSeconds(row?.updatedAtTimestamp) || currencyRes.data?.requestedAt || null,
      available: Boolean(currencyRes.ok && num(row?.bidPrice) != null),
    });
  }

  const coins = Array.isArray(cryptoRes.data?.coins) ? cryptoRes.data.coins : [];
  for (const [key, label] of [["BTC", "Bitcoin"], ["ETH", "Ethereum"]] as const) {
    const row = coins.find((x: any) => String(x?.coin).toUpperCase() === key);
    items.push({
      key, symbol: key, label, subtitle: `${key}/BRL · 24h`, value: num(row?.regularMarketPrice), changePct: num(row?.regularMarketChangePercent),
      format: "currency", currency: "BRL", group: "crypto", source: "brapi.dev", asOf: row?.regularMarketTime || cryptoRes.data?.requestedAt || null,
      available: Boolean(cryptoRes.ok && num(row?.regularMarketPrice) != null),
    });
  }

  const macroRows = Array.isArray(macroRes.data?.results) ? macroRes.data.results : [];
  const macroConfig: Record<string, { key: string; label: string; subtitle: string }> = {
    selic: { key: "SELIC", label: "Selic", subtitle: "taxa mais recente" },
    cdi: { key: "CDI", label: "CDI", subtitle: "última observação" },
    ipca12m: { key: "IPCA12M", label: "IPCA 12m", subtitle: "acumulado mais recente" },
  };
  for (const slug of ["selic", "cdi", "ipca12m"]) {
    const row = macroRows.find((x: any) => String(x?.series?.slug).toLowerCase() === slug);
    const cfg = macroConfig[slug];
    items.push({
      key: cfg.key, symbol: slug, label: cfg.label, subtitle: cfg.subtitle, value: num(row?.latest?.value), changePct: null,
      format: "percent", group: "macro", source: "brapi.dev / BCB", asOf: row?.latest?.date || macroRes.data?.requestedAt || null,
      available: Boolean(macroRes.ok && num(row?.latest?.value) != null), frequency: row?.series?.frequency || null, unit: row?.series?.unit || null,
    });
  }

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
  const globalRows = twelveRows(globalRes.data, globalSymbols);
  for (const symbol of globalSymbols) {
    const row = globalRows[symbol];
    const cfg = globalCfg[symbol];
    const close = num(row?.close ?? row?.price);
    items.push({
      key: symbol, symbol, label: cfg.label, subtitle: cfg.subtitle, value: close, changePct: num(row?.percent_change),
      format: "currency", currency: row?.currency || "USD", group: cfg.group, proxy: true, source: "Twelve Data",
      asOf: row?.timestamp ? isoFromUnixSeconds(row.timestamp) : (row?.datetime || null), marketOpen: typeof row?.is_market_open === "boolean" ? row.is_market_open : null,
      available: Boolean(globalKey && globalRes.ok && close != null),
    });
  }

  const failures: any[] = [];
  if (!ibovRes.ok) failures.push({ name: "Ibovespa", status: ibovRes.status });
  if (!currencyRes.ok) failures.push({ name: "Câmbio", status: currencyRes.status });
  if (!cryptoRes.ok) failures.push({ name: "Cripto", status: cryptoRes.status });
  if (!macroRes.ok) failures.push({ name: "Macro", status: macroRes.status });
  if (b3Quotes.some((x) => !x.res.ok)) failures.push({ name: "Ações B3 do desk", status: Math.max(...b3Quotes.map((x) => x.res.status || 0)) });
  if (globalKey && !globalRes.ok) failures.push({ name: "Mercados globais", status: globalRes.status });

  const globalMessage = globalKey
    ? "Exterior habilitado via Twelve Data. ETFs de referência para índices, commodities e Treasuries são identificados como proxies; disponibilidade e recência dependem do plano conectado."
    : "Exterior sem chave configurada. Defina TWELVE_DATA_API_KEY no ambiente Netlify para habilitar as referências globais do desk.";

  return json({
    requestedAt,
    source: "brapi.dev + Twelve Data",
    providerStatus: { brapiTokenConfigured: Boolean(brapiToken), globalProviderConfigured: Boolean(globalKey) },
    sessions: marketSessions(),
    items,
    failures,
    dataPolicy: `Brasil, moedas e macro: brapi.dev/BCB. ${globalMessage} Os horários de sessão são janelas regulares aproximadas e não substituem calendário oficial de feriados. A tela não deve ser interpretada como feed tick-by-tick universal.`,
  });
};

export const config: Config = { path: "/api/live-market" };
