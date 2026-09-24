import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, logActivity, validDateOnly } from "../lib/data.js";
import { json } from "../lib/http.js";

function serialize(row: any) {
  return {
    monthlyNetIncome: asNumber(row?.monthly_net_income),
    fixedExpenses: asNumber(row?.fixed_expenses),
    variableExpenses: asNumber(row?.variable_expenses),
    otherCommitments: asNumber(row?.other_commitments),
    emergencyReserve: asNumber(row?.emergency_reserve),
    debtsTotal: asNumber(row?.debts_total),
    otherInvestments: asNumber(row?.other_investments),
    realEstateEquity: asNumber(row?.real_estate_equity),
    otherAssets: asNumber(row?.other_assets),
    desiredReserveMonths: asNumber(row?.desired_reserve_months, 6),
    monthlyInvestmentGoal: asNumber(row?.monthly_investment_goal),
    netWorthGoal: asNumber(row?.net_worth_goal),
    netWorthGoalDate: row?.net_worth_goal_date || null,
    notes: row?.notes || "",
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
    const rows = await db.sql`SELECT * FROM personal_finance_profiles WHERE portfolio_id=${portfolioId} LIMIT 1`;
    return json({ profile: serialize(rows[0] || null) });
  }
  if (req.method !== "PUT") return json({ error: "Método não permitido." }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }

  const fields = {
    monthlyNetIncome: asNumber(body.monthlyNetIncome, -1),
    fixedExpenses: asNumber(body.fixedExpenses, -1),
    variableExpenses: asNumber(body.variableExpenses, -1),
    otherCommitments: asNumber(body.otherCommitments, -1),
    emergencyReserve: asNumber(body.emergencyReserve, -1),
    debtsTotal: asNumber(body.debtsTotal, -1),
    otherInvestments: asNumber(body.otherInvestments, -1),
    realEstateEquity: asNumber(body.realEstateEquity, -1),
    otherAssets: asNumber(body.otherAssets, -1),
    desiredReserveMonths: asNumber(body.desiredReserveMonths, 6),
    monthlyInvestmentGoal: asNumber(body.monthlyInvestmentGoal, -1),
    netWorthGoal: asNumber(body.netWorthGoal, -1),
  };
  if (Object.values(fields).some((v) => v < 0)) return json({ error: "Os valores financeiros não podem ser negativos." }, 400);
  if (fields.desiredReserveMonths > 60) return json({ error: "A meta de reserva deve ficar entre 0 e 60 meses." }, 400);
  const goalDate = body.netWorthGoalDate ? String(body.netWorthGoalDate) : null;
  if (goalDate && !validDateOnly(goalDate)) return json({ error: "Data da meta inválida." }, 400);
  const notes = cleanText(body.notes, 1500);

  const rows = await db.sql`
    INSERT INTO personal_finance_profiles (
      portfolio_id, monthly_net_income, fixed_expenses, variable_expenses, other_commitments,
      emergency_reserve, debts_total, other_investments, real_estate_equity, other_assets,
      desired_reserve_months, monthly_investment_goal, net_worth_goal, net_worth_goal_date, notes, updated_at
    ) VALUES (
      ${portfolioId}, ${fields.monthlyNetIncome}, ${fields.fixedExpenses}, ${fields.variableExpenses}, ${fields.otherCommitments},
      ${fields.emergencyReserve}, ${fields.debtsTotal}, ${fields.otherInvestments}, ${fields.realEstateEquity}, ${fields.otherAssets},
      ${fields.desiredReserveMonths}, ${fields.monthlyInvestmentGoal}, ${fields.netWorthGoal}, ${goalDate}, ${notes}, NOW()
    )
    ON CONFLICT (portfolio_id) DO UPDATE SET
      monthly_net_income=EXCLUDED.monthly_net_income, fixed_expenses=EXCLUDED.fixed_expenses,
      variable_expenses=EXCLUDED.variable_expenses, other_commitments=EXCLUDED.other_commitments,
      emergency_reserve=EXCLUDED.emergency_reserve, debts_total=EXCLUDED.debts_total,
      other_investments=EXCLUDED.other_investments, real_estate_equity=EXCLUDED.real_estate_equity,
      other_assets=EXCLUDED.other_assets, desired_reserve_months=EXCLUDED.desired_reserve_months,
      monthly_investment_goal=EXCLUDED.monthly_investment_goal, net_worth_goal=EXCLUDED.net_worth_goal,
      net_worth_goal_date=EXCLUDED.net_worth_goal_date, notes=EXCLUDED.notes, updated_at=NOW()
    RETURNING *
  `;
  await logActivity(portfolioId, "updated", "personal_finance", "Vida financeira", { profileUpdated: true });
  return json({ profile: serialize(rows[0]) });
};

export const config: Config = { path: "/api/personal-finance" };
