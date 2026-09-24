import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { ASSET_CLASSES, asNumber, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();

  if (req.method === "GET") {
    const rows = await db.sql`SELECT class_name, target_pct FROM allocation_targets WHERE portfolio_id = ${portfolioId}`;
    const map = Object.fromEntries(rows.map((r: any) => [r.class_name, asNumber(r.target_pct)]));
    return json({ targets: ASSET_CLASSES.map((className) => ({ className, targetPct: map[className] || 0 })) });
  }

  if (req.method !== "PUT") return json({ error: "Método não permitido." }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  if (!Array.isArray(body.targets)) return json({ error: "Metas inválidas." }, 400);

  const targets = ASSET_CLASSES.map((className) => {
    const found = body.targets.find((x: any) => x?.className === className);
    return { className, targetPct: asNumber(found?.targetPct, 0) };
  });
  if (targets.some((x) => x.targetPct < 0 || x.targetPct > 100)) return json({ error: "Cada meta deve ficar entre 0% e 100%." }, 400);
  const total = targets.reduce((sum, x) => sum + x.targetPct, 0);
  if (Math.abs(total - 100) > 0.01) return json({ error: `As metas precisam somar 100%. Total atual: ${total.toFixed(2)}%.` }, 400);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const target of targets) {
      await client.query(
        `INSERT INTO allocation_targets (portfolio_id, class_name, target_pct, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (portfolio_id, class_name)
         DO UPDATE SET target_pct = EXCLUDED.target_pct, updated_at = NOW()`,
        [portfolioId, target.className, target.targetPct],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await logActivity(portfolioId, "updated", "targets", "Metas por classe", { total: 100, targets });
  return json({ ok: true, targets });
};

export const config: Config = { path: "/api/targets" };
