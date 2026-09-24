import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

function serialize(row: any) {
  return {
    dailyEnabled: Boolean(row?.daily_enabled),
    refreshQuotes: row?.refresh_quotes !== false,
    evaluateRules: row?.evaluate_rules !== false,
    duplicateGuard: row?.duplicate_guard !== false,
    runOncePerDay: row?.run_once_per_day !== false,
    staleQuoteHours: Math.max(1, Math.min(168, asNumber(row?.stale_quote_hours, 12))),
    lastRunAt: row?.last_run_at || null,
    lastRunSummary: row?.last_run_summary || {},
    updatedAt: row?.updated_at || null,
  };
}

async function readSettings(portfolioId: number) {
  const db = getDatabase();
  const rows = await db.sql`
    SELECT * FROM automation_settings WHERE portfolio_id=${portfolioId} LIMIT 1
  ` as any[];
  return serialize(rows[0]);
}

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();

  if (req.method === "GET") return json({ settings: await readSettings(portfolioId) });

  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
    const dailyEnabled = body.dailyEnabled === true;
    const refreshQuotes = body.refreshQuotes !== false;
    const evaluateRules = body.evaluateRules !== false;
    const duplicateGuard = body.duplicateGuard !== false;
    const runOncePerDay = body.runOncePerDay !== false;
    const staleQuoteHours = Math.max(1, Math.min(168, Math.trunc(asNumber(body.staleQuoteHours, 12))));
    await db.sql`
      INSERT INTO automation_settings (
        portfolio_id, daily_enabled, refresh_quotes, evaluate_rules, duplicate_guard, run_once_per_day, stale_quote_hours
      ) VALUES (
        ${portfolioId}, ${dailyEnabled}, ${refreshQuotes}, ${evaluateRules}, ${duplicateGuard}, ${runOncePerDay}, ${staleQuoteHours}
      )
      ON CONFLICT (portfolio_id) DO UPDATE SET
        daily_enabled=EXCLUDED.daily_enabled,
        refresh_quotes=EXCLUDED.refresh_quotes,
        evaluate_rules=EXCLUDED.evaluate_rules,
        duplicate_guard=EXCLUDED.duplicate_guard,
        run_once_per_day=EXCLUDED.run_once_per_day,
        stale_quote_hours=EXCLUDED.stale_quote_hours,
        updated_at=NOW()
    `;
    await logActivity(portfolioId, "updated", "automation_settings", "Rotinas automáticas", { dailyEnabled, refreshQuotes, evaluateRules, duplicateGuard, runOncePerDay, staleQuoteHours });
    return json({ settings: await readSettings(portfolioId) });
  }

  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const summary = body?.summary && typeof body.summary === "object" ? body.summary : {};
    await db.sql`
      INSERT INTO automation_settings (portfolio_id, last_run_at, last_run_summary)
      VALUES (${portfolioId}, NOW(), ${JSON.stringify(summary)}::jsonb)
      ON CONFLICT (portfolio_id) DO UPDATE SET
        last_run_at=NOW(), last_run_summary=EXCLUDED.last_run_summary, updated_at=NOW()
    `;
    await logActivity(portfolioId, "ran", "automation", "Rotina automática", summary);
    return json({ settings: await readSettings(portfolioId) });
  }

  return json({ error: "Método não permitido." }, 405);
};

export const config: Config = { path: "/api/automation-settings" };
