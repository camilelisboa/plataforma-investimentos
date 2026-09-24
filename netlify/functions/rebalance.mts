import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, effectivePrice, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

type Item = { key: string; label: string; current: number; targetPct: number; targetValue: number; deficit: number; suggested: number; symbol?: string };

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const tolerancePct = Math.max(0, Math.min(20, asNumber(portfolio.rebalance_tolerance_pct, 3)));
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const contribution = asNumber(body.contribution, -1);
  if (contribution < 0 || contribution > 1_000_000_000) return json({ error: "Informe um aporte válido." }, 400);

  const db = getDatabase();
  const assets = await db.sql`SELECT * FROM assets WHERE portfolio_id = ${portfolioId} AND active = TRUE` as any[];
  if (!assets.length) return json({ error: "Cadastre pelo menos um ativo antes de calcular." }, 400);

  const currentTotal = assets.reduce((sum, a) => sum + asNumber(a.quantity) * effectivePrice(a), 0);
  const finalTotal = currentTotal + contribution;
  const assetTargetTotal = assets.reduce((sum, a) => sum + asNumber(a.target_pct), 0);
  let basis: "assets" | "classes" = "assets";
  let items: Item[] = [];

  if (Math.abs(assetTargetTotal - 100) <= 0.01) {
    items = assets.map((a) => {
      const current = asNumber(a.quantity) * effectivePrice(a);
      const targetPct = asNumber(a.target_pct);
      const targetValue = finalTotal * targetPct / 100;
      return { key: `asset-${a.id}`, label: `${a.symbol} · ${a.name}`, symbol: a.symbol, current, targetPct, targetValue, deficit: Math.max(0, targetValue - current), suggested: 0 };
    });
  } else {
    basis = "classes";
    const targets = await db.sql`SELECT class_name, target_pct FROM allocation_targets WHERE portfolio_id = ${portfolioId}` as any[];
    const targetTotal = targets.reduce((sum, t) => sum + asNumber(t.target_pct), 0);
    if (Math.abs(targetTotal - 100) > 0.01) {
      return json({ error: "Defina metas que somem 100% nos ativos ou nas classes antes de rebalancear." }, 400);
    }
    const byClass = new Map<string, number>();
    for (const a of assets) byClass.set(a.asset_class, (byClass.get(a.asset_class) || 0) + asNumber(a.quantity) * effectivePrice(a));
    items = targets.filter((t) => asNumber(t.target_pct) > 0).map((t) => {
      const current = byClass.get(t.class_name) || 0;
      const targetPct = asNumber(t.target_pct);
      const targetValue = finalTotal * targetPct / 100;
      return { key: `class-${t.class_name}`, label: t.class_name, current, targetPct, targetValue, deficit: Math.max(0, targetValue - current), suggested: 0 };
    });
  }

  // Rodada 4: pequenas oscilações dentro da banda de tolerância não recebem
  // prioridade de correção. Se ainda sobrar aporte depois dos desvios relevantes,
  // o restante volta a ser distribuído conforme os pesos-alvo.
  for (const item of items) {
    const currentPct = currentTotal > 0 ? (item.current / currentTotal) * 100 : 0;
    const underweightPct = item.targetPct - currentPct;
    if (underweightPct <= tolerancePct) item.deficit = 0;
  }

  let remaining = contribution;
  let active = items.filter((x) => x.deficit > 0.005);
  while (remaining > 0.005 && active.length) {
    const totalDeficit = active.reduce((sum, x) => sum + Math.max(0, x.deficit - x.suggested), 0);
    if (totalDeficit <= 0.005) break;
    for (const item of active) {
      if (remaining <= 0.005) break;
      const open = Math.max(0, item.deficit - item.suggested);
      const share = totalDeficit > 0 ? open / totalDeficit : 0;
      const add = Math.min(open, remaining * share);
      item.suggested += add;
    }
    const used = items.reduce((sum, x) => sum + x.suggested, 0);
    remaining = Math.max(0, contribution - used);
    active = items.filter((x) => x.deficit - x.suggested > 0.005);
    if (remaining > 0.005 && active.length === 0) break;
  }

  if (remaining > 0.005 && items.length) {
    const targetItems = items.filter((x) => x.targetPct > 0);
    const denominator = targetItems.reduce((sum, x) => sum + x.targetPct, 0) || 100;
    for (const item of targetItems) item.suggested += remaining * item.targetPct / denominator;
    remaining = 0;
  }

  const result = items.map((x) => {
    const after = x.current + x.suggested;
    return {
      label: x.label,
      symbol: x.symbol || null,
      targetPct: x.targetPct,
      currentValue: x.current,
      currentPct: currentTotal > 0 ? x.current / currentTotal * 100 : 0,
      suggestedAmount: x.suggested,
      afterValue: after,
      afterPct: finalTotal > 0 ? after / finalTotal * 100 : 0,
      gapAfter: x.targetValue - after,
      deviationPct: (currentTotal > 0 ? x.current / currentTotal * 100 : 0) - x.targetPct,
      outsideTolerance: Math.abs((currentTotal > 0 ? x.current / currentTotal * 100 : 0) - x.targetPct) > tolerancePct,
    };
  }).sort((a, b) => b.suggestedAmount - a.suggestedAmount);

  await db.sql`UPDATE portfolios SET last_rebalance_amount = ${contribution}, updated_at = NOW() WHERE id = ${portfolioId}`;
  await logActivity(portfolioId, "calculated", "rebalance", "Rebalanceamento", { contribution, basis });

  return json({
    contribution,
    basis,
    currentTotal,
    finalTotal,
    suggestions: result,
    tolerancePct,
    note: basis === "assets"
      ? `A sugestão segue as metas individuais definidas por você e prioriza desvios maiores que ±${tolerancePct.toFixed(2)}%.`
      : `A sugestão segue as metas por classe definidas por você e prioriza desvios maiores que ±${tolerancePct.toFixed(2)}%; a escolha do ativo dentro de cada classe continua sendo sua.`,
  });
};

export const config: Config = { path: "/api/rebalance" };
