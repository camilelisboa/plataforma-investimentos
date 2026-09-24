import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, getPortfolioForUser, upsertTodaySnapshot } from "../lib/data.js";
import { json } from "../lib/http.js";

async function getBenchmark(symbol: string) {
  try {
    const token = Netlify.env.get("BRAPI_TOKEN") || "";
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) return { symbol, available: false, points: [] };
    const payload: any = await response.json();
    const item = payload?.results?.[0];
    const raw = Array.isArray(item?.historicalDataPrice) ? item.historicalDataPrice : [];
    const points = raw.map((p: any) => ({
      date: new Date(asNumber(p.date) * 1000).toISOString().slice(0, 10),
      value: asNumber(p.adjustedClose ?? p.close, NaN),
    })).filter((p: any) => Number.isFinite(p.value) && p.value > 0)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    return { symbol, available: points.length > 1, points };
  } catch {
    return { symbol, available: false, points: [] };
  }
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  await upsertTodaySnapshot(portfolioId);
  const db = getDatabase();
  const rows = await db.sql`
    SELECT snapshot_date, market_value, invested_value, cumulative_contributions, cumulative_withdrawals, cumulative_income
    FROM portfolio_snapshots WHERE portfolio_id=${portfolioId}
    ORDER BY snapshot_date ASC LIMIT 730
  ` as any[];
  const points = rows.map((r) => ({
    date: r.snapshot_date,
    marketValue: asNumber(r.market_value), investedValue: asNumber(r.invested_value),
    contributions: asNumber(r.cumulative_contributions), withdrawals: asNumber(r.cumulative_withdrawals),
    income: asNumber(r.cumulative_income),
  }));
  const first = points[0];
  const last = points[points.length - 1];
  const netFlows = last ? last.contributions - last.withdrawals : 0;
  const simpleTrackedResult = last ? last.marketValue + last.withdrawals + last.income - last.contributions : 0;
  const benchmark = await getBenchmark(String(portfolio.benchmark_symbol || "^BVSP"));
  return json({
    points,
    benchmark,
    tracked: {
      startDate: first?.date || null, endDate: last?.date || null,
      currentValue: last?.marketValue || 0, netFlows, income: last?.income || 0,
      resultAfterFlows: simpleTrackedResult,
    },
  });
};

export const config: Config = { path: "/api/performance" };
