import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, getPortfolioForUser, getRawPortfolioMetrics, getPortfolioMetrics, logActivity, upsertTodaySnapshot } from "../lib/data.js";
import { json } from "../lib/http.js";

const FIELDS = ["marketValue", "invested", "contributions", "withdrawals", "income"] as const;
type Field = typeof FIELDS[number];

function parseNullableNonNegative(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

function serializeRow(row: any, effective: any, raw: any) {
  return {
    values: {
      marketValue: effective.currentValue,
      invested: effective.invested,
      contributions: effective.cumulativeContributions,
      withdrawals: effective.cumulativeWithdrawals,
      income: effective.cumulativeIncome,
    },
    manual: {
      marketValue: row?.market_value_base == null ? null : asNumber(row.market_value_base),
      invested: row?.invested_value_base == null ? null : asNumber(row.invested_value_base),
      contributions: row?.contributions_base == null ? null : asNumber(row.contributions_base),
      withdrawals: row?.withdrawals_base == null ? null : asNumber(row.withdrawals_base),
      income: row?.income_base == null ? null : asNumber(row.income_base),
    },
    automatic: {
      marketValue: raw.currentValue,
      invested: raw.invested,
      contributions: raw.cumulativeContributions,
      withdrawals: raw.cumulativeWithdrawals,
      income: raw.cumulativeIncome,
    },
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
    const rows = await db.sql`SELECT * FROM portfolio_financial_baselines WHERE portfolio_id=${portfolioId} LIMIT 1` as any[];
    const raw = await getRawPortfolioMetrics(portfolioId);
    const effective = await getPortfolioMetrics(portfolioId);
    return json({ balances: serializeRow(rows[0], effective, raw) });
  }

  if (req.method !== "PUT") return json({ error: "Método não permitido." }, 405);
  const payload: any = await req.json().catch(() => ({}));
  const values: Record<Field, number | null> = {} as any;
  for (const key of FIELDS) {
    const parsed = parseNullableNonNegative(payload[key]);
    if (Number.isNaN(parsed)) return json({ error: "Use apenas valores iguais ou maiores que zero." }, 400);
    values[key] = parsed;
  }

  const raw = await getRawPortfolioMetrics(portfolioId);
  const minimums: Record<Field, number> = {
    marketValue: raw.currentValue,
    invested: raw.invested,
    contributions: raw.cumulativeContributions,
    withdrawals: raw.cumulativeWithdrawals,
    income: raw.cumulativeIncome,
  };
  const labels: Record<Field, string> = {
    marketValue: "patrimônio atual",
    invested: "total investido",
    contributions: "aportes acumulados",
    withdrawals: "retiradas acumuladas",
    income: "proventos acumulados",
  };
  for (const key of FIELDS) {
    const value = values[key];
    if (value != null && value + 0.005 < minimums[key]) {
      return json({ error: `O ${labels[key]} não pode ficar abaixo dos registros detalhados já existentes (${minimums[key].toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). Edite ou remova os lançamentos detalhados primeiro.` }, 400);
    }
  }

  await db.sql`
    INSERT INTO portfolio_financial_baselines (
      portfolio_id, market_value_base, invested_value_base, contributions_base, withdrawals_base, income_base,
      raw_market_reference, raw_invested_reference, raw_contributions_reference, raw_withdrawals_reference, raw_income_reference, updated_at
    ) VALUES (
      ${portfolioId}, ${values.marketValue}, ${values.invested}, ${values.contributions}, ${values.withdrawals}, ${values.income},
      ${raw.currentValue}, ${raw.invested}, ${raw.cumulativeContributions}, ${raw.cumulativeWithdrawals}, ${raw.cumulativeIncome}, NOW()
    )
    ON CONFLICT (portfolio_id) DO UPDATE SET
      market_value_base=EXCLUDED.market_value_base,
      invested_value_base=EXCLUDED.invested_value_base,
      contributions_base=EXCLUDED.contributions_base,
      withdrawals_base=EXCLUDED.withdrawals_base,
      income_base=EXCLUDED.income_base,
      raw_market_reference=EXCLUDED.raw_market_reference,
      raw_invested_reference=EXCLUDED.raw_invested_reference,
      raw_contributions_reference=EXCLUDED.raw_contributions_reference,
      raw_withdrawals_reference=EXCLUDED.raw_withdrawals_reference,
      raw_income_reference=EXCLUDED.raw_income_reference,
      updated_at=NOW()
  `;
  await logActivity(portfolioId, "updated", "financial_baseline", "Bases financeiras", { manual: values, automaticAtEdit: minimums });
  await upsertTodaySnapshot(portfolioId);
  const [row] = await db.sql`SELECT * FROM portfolio_financial_baselines WHERE portfolio_id=${portfolioId} LIMIT 1` as any[];
  const effective = await getPortfolioMetrics(portfolioId);
  return json({ balances: serializeRow(row, effective, raw) });
};

export const config: Config = { path: "/api/manual-balances" };
