import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();

  if (req.method === "GET") {
    return json({ tolerancePct: asNumber(portfolio.rebalance_tolerance_pct, 3), mode: "CONTRIBUTION_ONLY" });
  }
  if (req.method !== "PUT") return json({ error: "Método não permitido." }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const tolerancePct = asNumber(body.tolerancePct, -1);
  if (tolerancePct < 0 || tolerancePct > 20) return json({ error: "A tolerância deve ficar entre 0% e 20%." }, 400);

  await db.sql`
    UPDATE portfolios
    SET rebalance_tolerance_pct = ${tolerancePct}, updated_at = NOW()
    WHERE id = ${portfolioId}
  `;
  await logActivity(portfolioId, "updated", "strategy", "Faixa de tolerância", { tolerancePct });
  return json({ ok: true, tolerancePct, mode: "CONTRIBUTION_ONLY" });
};

export const config: Config = { path: "/api/strategy" };
