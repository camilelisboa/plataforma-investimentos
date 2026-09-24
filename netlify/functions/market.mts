import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, getPortfolioForUser, logActivity, upsertTodaySnapshot } from "../lib/data.js";
import { json } from "../lib/http.js";

const SANDBOX = new Set(["PETR4", "VALE3", "MGLU3", "ITUB4"]);
function marketReading(change: number | null) {
  if (change == null || !Number.isFinite(change)) return "Sem variação disponível";
  if (change >= 1.5) return "Alta forte no dia";
  if (change >= 0.35) return "Alta no dia";
  if (change <= -1.5) return "Queda forte no dia";
  if (change <= -0.35) return "Queda no dia";
  return "Movimento lateral";
}

async function quote(symbol: string, token: string) {
  if (!token && !SANDBOX.has(symbol)) return { ok: false, symbol, message: "Token brapi necessário para este ticker." };
  try {
    const url = `https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`;
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) return { ok: false, symbol, message: `Fonte de mercado respondeu ${response.status}.` };
    const payload: any = await response.json();
    const data = payload?.results?.[0]?.data;
    const price = asNumber(data?.regularMarketPrice, NaN);
    const change = asNumber(data?.regularMarketChangePercent, NaN);
    if (!Number.isFinite(price) || price < 0) return { ok: false, symbol, message: "Cotação indisponível." };
    const requestedAt = payload?.requestedAt ? new Date(payload.requestedAt) : new Date();
    const safeChange = Number.isFinite(change) ? change : null;
    return { ok: true, symbol, price, changePct: safeChange, requestedAt: requestedAt.toISOString(), reading: marketReading(safeChange) };
  } catch {
    return { ok: false, symbol, message: "Falha temporária ao consultar a cotação." };
  }
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();
  const assets = await db.sql`
    SELECT id, symbol FROM assets
    WHERE portfolio_id=${portfolioId} AND active=TRUE AND auto_quote=TRUE
    ORDER BY symbol LIMIT 30
  ` as any[];
  const watch = await db.sql`SELECT id, symbol FROM watchlist WHERE portfolio_id=${portfolioId} ORDER BY symbol LIMIT 30` as any[];
  const token = Netlify.env.get("BRAPI_TOKEN") || "";
  const results: any[] = [];
  const cache = new Map<string, any>();

  for (const row of [...assets, ...watch]) {
    const symbol = String(row.symbol).toUpperCase();
    if (!cache.has(symbol)) cache.set(symbol, await quote(symbol, token));
  }
  for (const asset of assets) {
    const result = cache.get(String(asset.symbol).toUpperCase());
    if (result?.ok) {
      await db.sql`
        UPDATE assets SET market_price=${result.price}, market_change_pct=${result.changePct},
          market_price_at=${result.requestedAt}, quote_source=${"brapi.dev"}, updated_at=NOW()
        WHERE id=${asset.id} AND portfolio_id=${portfolioId}
      `;
    }
    results.push({ ...result, scope: "portfolio" });
  }
  for (const item of watch) {
    const result = cache.get(String(item.symbol).toUpperCase());
    if (result?.ok) {
      await db.sql`
        UPDATE watchlist SET market_price=${result.price}, market_change_pct=${result.changePct},
          market_price_at=${result.requestedAt}, quote_source=${"brapi.dev"}, updated_at=NOW()
        WHERE id=${item.id} AND portfolio_id=${portfolioId}
      `;
    }
    results.push({ ...result, scope: "watchlist" });
  }
  await logActivity(portfolioId, "refreshed", "market", "Cotações", { updated: results.filter((x) => x.ok).length, total: results.length });
  await upsertTodaySnapshot(portfolioId);
  return json({
    results, source: "brapi.dev", tokenConfigured: Boolean(token),
    dataPolicy: token ? "A recência depende do plano contratado na brapi." : "Sem token, somente PETR4, VALE3, MGLU3 e ITUB4 podem ser consultadas no sandbox.",
  });
};

export const config: Config = { path: "/api/market" };
