import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, getPortfolioForUser, upsertTodaySnapshot } from "../lib/data.js";
import { json } from "../lib/http.js";

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();
  const metrics = await upsertTodaySnapshot(portfolioId);
  const targets = await db.sql`SELECT class_name, target_pct FROM allocation_targets WHERE portfolio_id=${portfolioId}` as any[];
  const targetCoverage = targets.reduce((sum, row) => sum + asNumber(row.target_pct), 0);
  const watchRows = await db.sql`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE market_price IS NOT NULL AND target_buy_price IS NOT NULL AND market_price <= target_buy_price) AS alerts
    FROM watchlist WHERE portfolio_id=${portfolioId}
  ` as any[];

  return json({ portfolio: {
    id: portfolioId, name: portfolio.name, currency: portfolio.currency,
    invested: metrics.invested, currentValue: metrics.currentValue,
    profitLoss: metrics.profitLoss, profitLossPct: metrics.profitLossPct,
    assetsCount: metrics.assets.length, targetCoverage, allocation: metrics.allocation,
    lastQuoteAt: metrics.latestQuote?.toISOString() || null,
    cumulativeContributions: metrics.cumulativeContributions,
    cumulativeWithdrawals: metrics.cumulativeWithdrawals,
    cumulativeIncome: metrics.cumulativeIncome,
    watchlistCount: Number(watchRows[0]?.total || 0), watchAlerts: Number(watchRows[0]?.alerts || 0),
  }});
};

export const config: Config = { path: "/api/summary" };
