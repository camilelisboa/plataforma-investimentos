import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

function serialize(row: any) {
  return {
    annualReturnPct: asNumber(row?.annual_return_pct, 8),
    inflationPct: asNumber(row?.inflation_pct, 4.5),
    horizonYears: Math.trunc(asNumber(row?.horizon_years, 10)),
    wealthMonthlyContribution: row?.wealth_monthly_contribution == null ? null : asNumber(row.wealth_monthly_contribution, 0),
    passiveIncomeYieldPct: asNumber(row?.passive_income_yield_pct, 5),
    updatedAt: row?.updated_at || null,
  };
}

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();

  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM planning_settings WHERE portfolio_id=${portfolioId} LIMIT 1`;
    return json({ settings: serialize(rows[0] || null) });
  }
  if (req.method !== "PUT") return json({ error: "Método não permitido." }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const annualReturnPct = asNumber(body.annualReturnPct, NaN);
  const inflationPct = asNumber(body.inflationPct, NaN);
  const horizonYears = Math.trunc(asNumber(body.horizonYears, NaN));
  const wealthMonthlyContribution = body.wealthMonthlyContribution == null ? null : asNumber(body.wealthMonthlyContribution, NaN);
  const passiveIncomeYieldPct = body.passiveIncomeYieldPct == null ? 5 : asNumber(body.passiveIncomeYieldPct, NaN);
  if (!Number.isFinite(annualReturnPct) || annualReturnPct < -100 || annualReturnPct > 1000) return json({ error: "Retorno anual inválido." }, 400);
  if (!Number.isFinite(inflationPct) || inflationPct < -50 || inflationPct > 1000) return json({ error: "Inflação inválida." }, 400);
  if (!Number.isFinite(horizonYears) || horizonYears < 1 || horizonYears > 60) return json({ error: "Horizonte deve ficar entre 1 e 60 anos." }, 400);
  if (wealthMonthlyContribution != null && (!Number.isFinite(wealthMonthlyContribution) || wealthMonthlyContribution < 0 || wealthMonthlyContribution > 1000000000)) return json({ error: "Aporte mensal inválido." }, 400);
  if (!Number.isFinite(passiveIncomeYieldPct) || passiveIncomeYieldPct < 0 || passiveIncomeYieldPct > 100) return json({ error: "Yield anual inválido." }, 400);

  const rows = await db.sql`
    INSERT INTO planning_settings (portfolio_id, annual_return_pct, inflation_pct, horizon_years, wealth_monthly_contribution, passive_income_yield_pct, updated_at)
    VALUES (${portfolioId}, ${annualReturnPct}, ${inflationPct}, ${horizonYears}, ${wealthMonthlyContribution}, ${passiveIncomeYieldPct}, NOW())
    ON CONFLICT (portfolio_id) DO UPDATE SET
      annual_return_pct=EXCLUDED.annual_return_pct,
      inflation_pct=EXCLUDED.inflation_pct,
      horizon_years=EXCLUDED.horizon_years,
      wealth_monthly_contribution=EXCLUDED.wealth_monthly_contribution,
      passive_income_yield_pct=EXCLUDED.passive_income_yield_pct,
      updated_at=NOW()
    RETURNING *
  `;
  await logActivity(portfolioId, "updated", "planning", "Planejamento", { annualReturnPct, inflationPct, horizonYears, wealthMonthlyContribution, passiveIncomeYieldPct });
  return json({ settings: serialize(rows[0]) });
};

export const config: Config = { path: "/api/planning-settings" };
