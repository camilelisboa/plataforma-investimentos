import { getDatabase } from "@netlify/database";
import { upsertTodaySnapshot } from "./data.js";

function n(value: unknown): number | null {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}
function dateOnly(value: unknown) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}
async function getJson(url: string, token = "") {
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) return { ok: false as const, status: response.status, data: null as any };
    return { ok: true as const, status: response.status, data: await response.json() as any };
  } catch {
    return { ok: false as const, status: 0, data: null as any };
  }
}
async function quote(symbol: string, token: string) {
  const out = await getJson(`https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`, token);
  const envelope = out.data?.results?.[0];
  const data = envelope?.data ?? envelope;
  const price = n(data?.regularMarketPrice);
  if (!out.ok || price == null || price < 0) return { ok: false, symbol, status: out.status };
  return {
    ok: true,
    symbol,
    price,
    changePct: n(data?.regularMarketChangePercent),
    requestedAt: data?.regularMarketTime || out.data?.requestedAt || new Date().toISOString(),
  };
}
async function dividends(symbols: string[], kind: "stocks" | "fii", token: string) {
  if (!symbols.length) return [] as any[];
  const start = new Date();
  const end = new Date(start); end.setFullYear(end.getFullYear() + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const out = await getJson(`https://brapi.dev/api/v2/${kind}/dividends?symbols=${encodeURIComponent(symbols.slice(0, 20).join(","))}&startDate=${fmt(start)}&endDate=${fmt(end)}&sortBy=paymentDate&sortOrder=asc`, token);
  if (!out.ok) return [] as any[];
  const rows: any[] = [];
  if (kind === "fii" && Array.isArray(out.data?.dividends)) {
    for (const ev of out.data.dividends) {
      if (!ev?.paymentDate) continue;
      rows.push({
        symbol: String(ev?.symbol || "").toUpperCase(),
        paymentDate: String(ev.paymentDate).slice(0, 10),
        label: String(ev.label || "Rendimento"),
        rate: n(ev.rate) || 0,
      });
    }
    return rows;
  }
  for (const result of out.data?.results || []) {
    const symbol = String(result?.symbol || result?.requestedSymbol || "").toUpperCase();
    const data = result?.data || result;
    for (const ev of data?.cashDividends || data?.dividends || []) {
      if (!ev?.paymentDate) continue;
      rows.push({ symbol, paymentDate: String(ev.paymentDate).slice(0,10), label: String(ev.label || ev.type || "Provento"), rate: n(ev.rate) || 0 });
    }
  }
  return rows;
}

export async function integrationSettings(portfolioId: number) {
  const db = getDatabase();
  const rows = await db.sql`SELECT * FROM integration_settings WHERE portfolio_id=${portfolioId} LIMIT 1` as any[];
  const r = rows[0] || {};
  return {
    marketEnabled: r.market_enabled !== false,
    agendaEnabled: r.agenda_enabled !== false,
    benchmarksEnabled: r.benchmarks_enabled !== false,
    autoSyncEnabled: Boolean(r.auto_sync_enabled),
    syncHourLocal: Number(r.sync_hour_local ?? 7),
    lastSyncAt: r.last_sync_at || null,
    lastSyncSummary: r.last_sync_summary || {},
    updatedAt: r.updated_at || null,
  };
}

export async function runIntegrationSync(portfolioId: number, triggerKind: "MANUAL" | "SCHEDULED" = "MANUAL") {
  const db = getDatabase();
  const settings = await integrationSettings(portfolioId);
  const runRows = await db.sql`INSERT INTO integration_runs(portfolio_id,trigger_kind,status,details) VALUES(${portfolioId},${triggerKind},'SUCCESS','{}'::jsonb) RETURNING id` as any[];
  const runId = Number(runRows[0]?.id);
  const token = Netlify.env.get("BRAPI_TOKEN") || "";
  const summary: any = { quotesUpdated: 0, quoteErrors: 0, calendarEvents: 0, benchmarks: 0, triggerKind, tokenConfigured: Boolean(token) };
  let failedGroups = 0;
  try {
    const assets = await db.sql`SELECT id,symbol,asset_class,auto_quote FROM assets WHERE portfolio_id=${portfolioId} AND active=TRUE ORDER BY symbol LIMIT 50` as any[];
    const watchlist = await db.sql`SELECT id,symbol FROM watchlist WHERE portfolio_id=${portfolioId} ORDER BY symbol LIMIT 30` as any[];
    if (settings.marketEnabled) {
      const cache = new Map<string, any>();
      const symbols = [...new Set([...assets.filter(a=>a.auto_quote!==false).map(a=>String(a.symbol).toUpperCase()),...watchlist.map(w=>String(w.symbol).toUpperCase())].filter(Boolean))];
      for (const symbol of symbols) cache.set(symbol, await quote(symbol, token));
      for (const asset of assets.filter(a => a.auto_quote !== false)) {
        const result = cache.get(String(asset.symbol).toUpperCase());
        if (result?.ok) {
          await db.sql`UPDATE assets SET market_price=${result.price}, market_change_pct=${result.changePct}, market_price_at=${result.requestedAt}, quote_source='brapi.dev', updated_at=NOW() WHERE id=${asset.id} AND portfolio_id=${portfolioId}`;
          summary.quotesUpdated++;
        } else summary.quoteErrors++;
      }
      for (const item of watchlist) {
        const result = cache.get(String(item.symbol).toUpperCase());
        if (result?.ok) await db.sql`UPDATE watchlist SET market_price=${result.price},market_change_pct=${result.changePct},market_price_at=${result.requestedAt},quote_source='brapi.dev',updated_at=NOW() WHERE id=${item.id} AND portfolio_id=${portfolioId}`;
      }
      if (summary.quotesUpdated) await upsertTodaySnapshot(portfolioId);
      if (!summary.quotesUpdated && summary.quoteErrors) failedGroups++;
    }
    if (settings.agendaEnabled) {
      const stocks = assets.filter(a => String(a.asset_class) !== 'FIIs').map(a => String(a.symbol).toUpperCase()).filter(Boolean);
      const fiis = assets.filter(a => String(a.asset_class) === 'FIIs').map(a => String(a.symbol).toUpperCase()).filter(Boolean);
      const rows = [...await dividends(stocks, 'stocks', token), ...await dividends(fiis, 'fii', token)];
      for (const ev of rows) {
        const ext = `brapi-dividend:${ev.symbol}:${ev.paymentDate}:${ev.label}:${ev.rate}`.slice(0,480);
        const title = `${ev.symbol} · ${ev.label}`.slice(0,140);
        const description = `Evento corporativo sincronizado. Valor informado pela fonte: ${ev.rate}. Confirme o comunicado oficial antes de tomar decisões.`;
        await db.sql`
          INSERT INTO finance_calendar_events(portfolio_id,event_date,category,title,description,source_url,external_key,integration_source)
          VALUES(${portfolioId},${ev.paymentDate},'CORPORATE',${title},${description},'https://brapi.dev',${ext},'brapi.dev')
          ON CONFLICT (portfolio_id,external_key) WHERE external_key IS NOT NULL DO UPDATE SET event_date=EXCLUDED.event_date,title=EXCLUDED.title,description=EXCLUDED.description,updated_at=NOW()
        `;
      }
      summary.calendarEvents = rows.length;
    }
    if (settings.benchmarksEnabled) {
      const [macro, ibov] = await Promise.all([
        getJson('https://brapi.dev/api/v2/macro/latest?symbols=selic,cdi,ipca12m', token),
        getJson('https://brapi.dev/api/v2/stocks/quote?symbols=%5EBVSP', token),
      ]);
      const macroRows = Array.isArray(macro.data?.results) ? macro.data.results : [];
      for (const [slug,key] of [['selic','SELIC'],['cdi','CDI'],['ipca12m','IPCA12M']] as const) {
        const row = macroRows.find((x:any)=>String(x?.series?.slug).toLowerCase()===slug);
        const value = n(row?.latest?.value);
        if (value == null) continue;
        const obs = dateOnly(row?.latest?.date || macro.data?.requestedAt);
        await db.sql`INSERT INTO benchmark_observations(portfolio_id,benchmark_key,observation_date,value,source) VALUES(${portfolioId},${key},${obs},${value},'BCB via brapi.dev') ON CONFLICT(portfolio_id,benchmark_key,observation_date) DO UPDATE SET value=EXCLUDED.value,source=EXCLUDED.source`;
        summary.benchmarks++;
      }
      const env = ibov.data?.results?.[0]; const row = env?.data ?? env; const value = n(row?.regularMarketPrice);
      if (value != null) {
        const obs = dateOnly(row?.regularMarketTime || ibov.data?.requestedAt);
        await db.sql`INSERT INTO benchmark_observations(portfolio_id,benchmark_key,observation_date,value,source) VALUES(${portfolioId},'IBOV',${obs},${value},'brapi.dev') ON CONFLICT(portfolio_id,benchmark_key,observation_date) DO UPDATE SET value=EXCLUDED.value,source=EXCLUDED.source`;
        summary.benchmarks++;
      }
      if (!summary.benchmarks) failedGroups++;
    }
    const status = failedGroups >= 2 ? 'FAILED' : failedGroups ? 'PARTIAL' : 'SUCCESS';
    await db.sql`UPDATE integration_runs SET status=${status},details=${JSON.stringify(summary)}::jsonb,completed_at=NOW() WHERE id=${runId}`;
    await db.sql`UPDATE integration_settings SET last_sync_at=NOW(),last_sync_summary=${JSON.stringify(summary)}::jsonb,updated_at=NOW() WHERE portfolio_id=${portfolioId}`;
    return { status, summary };
  } catch (error) {
    summary.error = error instanceof Error ? error.message : 'Falha inesperada';
    await db.sql`UPDATE integration_runs SET status='FAILED',details=${JSON.stringify(summary)}::jsonb,completed_at=NOW() WHERE id=${runId}`;
    throw error;
  }
}
