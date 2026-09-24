import { getDatabase } from "@netlify/database";
import type { SessionUser } from "./auth.js";

export const ASSET_CLASSES = [
  "Ações BR",
  "FIIs",
  "ETFs",
  "Renda Fixa",
  "Exterior",
  "Cripto",
  "Caixa",
  "Outros",
] as const;

export const TRANSACTION_KINDS = ["BUY", "SELL", "DEPOSIT", "WITHDRAWAL"] as const;
export const INCOME_TYPES = ["DIVIDEND", "JCP", "FII_INCOME", "INTEREST", "COUPON", "OTHER"] as const;

export async function getPortfolioForUser(user: SessionUser) {
  const db = getDatabase();
  const rows = await db.sql`
    SELECT id, name, currency, last_rebalance_amount, benchmark_symbol, tracking_start_date, rebalance_tolerance_pct, updated_at
    FROM portfolios
    WHERE user_id = ${user.id}
    LIMIT 1
  `;
  return rows[0] as any | undefined;
}

export function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function effectivePrice(asset: any) {
  const market = asNumber(asset.market_price, NaN);
  const manual = asNumber(asset.manual_price, NaN);
  const average = asNumber(asset.average_price, 0);
  if (asset.auto_quote && Number.isFinite(market)) return market;
  if (Number.isFinite(manual)) return manual;
  if (Number.isFinite(market)) return market;
  return average;
}

export function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "-").slice(0, 32);
}

export function cleanText(value: unknown, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validDateOnly(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function logActivity(portfolioId: number, action: string, entityType: string, entityLabel: string, details: unknown = {}) {
  const db = getDatabase();
  await db.sql`
    INSERT INTO activity_log (portfolio_id, action, entity_type, entity_label, details)
    VALUES (${portfolioId}, ${action}, ${entityType}, ${entityLabel}, ${JSON.stringify(details)}::jsonb)
  `;
}

export async function getRawPortfolioMetrics(portfolioId: number) {
  const db = getDatabase();
  const assets = await db.sql`
    SELECT * FROM assets
    WHERE portfolio_id = ${portfolioId} AND active = TRUE
    ORDER BY asset_class, symbol
  ` as any[];

  let invested = 0;
  let currentValue = 0;
  let latestQuote: Date | null = null;
  const allocationMap = new Map<string, number>();
  for (const row of assets) {
    const quantity = asNumber(row.quantity);
    const average = asNumber(row.average_price);
    const price = effectivePrice(row);
    const value = quantity * price;
    invested += quantity * average;
    currentValue += value;
    allocationMap.set(row.asset_class, (allocationMap.get(row.asset_class) || 0) + value);
    if (row.market_price_at) {
      const d = new Date(row.market_price_at);
      if (!latestQuote || d > latestQuote) latestQuote = d;
    }
  }

  const cashFlows = await db.sql`
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'DEPOSIT' THEN unit_price ELSE 0 END), 0) AS contributions,
      COALESCE(SUM(CASE WHEN kind = 'WITHDRAWAL' THEN unit_price ELSE 0 END), 0) AS withdrawals
    FROM transactions
    WHERE portfolio_id = ${portfolioId}
  ` as any[];
  const incomeRows = await db.sql`
    SELECT COALESCE(SUM(gross_amount - tax_amount), 0) AS income
    FROM income_events
    WHERE portfolio_id = ${portfolioId}
  ` as any[];

  const cumulativeContributions = asNumber(cashFlows[0]?.contributions);
  const cumulativeWithdrawals = asNumber(cashFlows[0]?.withdrawals);
  const cumulativeIncome = asNumber(incomeRows[0]?.income);

  return {
    assets,
    invested,
    currentValue,
    latestQuote,
    cumulativeContributions,
    cumulativeWithdrawals,
    cumulativeIncome,
    allocation: [...allocationMap.entries()].map(([className, value]) => ({
      className,
      value,
      pct: currentValue > 0 ? (value / currentValue) * 100 : 0,
    })).sort((a, b) => b.value - a.value),
  };
}

function adjustedFromBaseline(base: unknown, reference: unknown, rawValue: number) {
  if (base === null || base === undefined) return rawValue;
  return Math.max(0, asNumber(base) + (rawValue - asNumber(reference)));
}

export async function getPortfolioMetrics(portfolioId: number) {
  const db = getDatabase();
  const raw = await getRawPortfolioMetrics(portfolioId);
  const baselineRows = await db.sql`
    SELECT * FROM portfolio_financial_baselines WHERE portfolio_id=${portfolioId} LIMIT 1
  ` as any[];
  const baseline = baselineRows[0];

  const currentValue = baseline ? adjustedFromBaseline(baseline.market_value_base, baseline.raw_market_reference, raw.currentValue) : raw.currentValue;
  const invested = baseline ? adjustedFromBaseline(baseline.invested_value_base, baseline.raw_invested_reference, raw.invested) : raw.invested;
  const cumulativeContributions = baseline ? adjustedFromBaseline(baseline.contributions_base, baseline.raw_contributions_reference, raw.cumulativeContributions) : raw.cumulativeContributions;
  const cumulativeWithdrawals = baseline ? adjustedFromBaseline(baseline.withdrawals_base, baseline.raw_withdrawals_reference, raw.cumulativeWithdrawals) : raw.cumulativeWithdrawals;
  const cumulativeIncome = baseline ? adjustedFromBaseline(baseline.income_base, baseline.raw_income_reference, raw.cumulativeIncome) : raw.cumulativeIncome;

  const allocation = raw.allocation.map((row) => ({ ...row }));
  const manualAdjustment = currentValue - raw.currentValue;
  if (manualAdjustment > 0.005) allocation.push({ className: "Base manual", value: manualAdjustment, pct: 0 });
  const positiveTotal = allocation.reduce((sum, row) => sum + Math.max(0, Number(row.value) || 0), 0);
  for (const row of allocation) row.pct = positiveTotal > 0 ? Math.max(0, Number(row.value) || 0) / positiveTotal * 100 : 0;
  allocation.sort((a, b) => b.value - a.value);

  return {
    assets: raw.assets,
    invested,
    currentValue,
    profitLoss: currentValue - invested,
    profitLossPct: invested > 0 ? ((currentValue - invested) / invested) * 100 : 0,
    latestQuote: raw.latestQuote,
    cumulativeContributions,
    cumulativeWithdrawals,
    cumulativeIncome,
    manualAdjustment,
    allocation,
  };
}

export async function upsertTodaySnapshot(portfolioId: number) {
  const db = getDatabase();
  const metrics = await getPortfolioMetrics(portfolioId);
  await db.sql`
    INSERT INTO portfolio_snapshots (
      portfolio_id, snapshot_date, market_value, invested_value,
      cumulative_contributions, cumulative_withdrawals, cumulative_income
    ) VALUES (
      ${portfolioId}, CURRENT_DATE, ${metrics.currentValue}, ${metrics.invested},
      ${metrics.cumulativeContributions}, ${metrics.cumulativeWithdrawals}, ${metrics.cumulativeIncome}
    )
    ON CONFLICT (portfolio_id, snapshot_date) DO UPDATE SET
      market_value = EXCLUDED.market_value,
      invested_value = EXCLUDED.invested_value,
      cumulative_contributions = EXCLUDED.cumulative_contributions,
      cumulative_withdrawals = EXCLUDED.cumulative_withdrawals,
      cumulative_income = EXCLUDED.cumulative_income,
      updated_at = NOW()
  `;
  return metrics;
}
