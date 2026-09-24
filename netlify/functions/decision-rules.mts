import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { cleanText, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

const DEFAULTS = [
  { key: "allocation_tolerance", enabled: true, threshold: 3 },
  { key: "asset_weight", enabled: true, threshold: 25 },
  { key: "stale_quote", enabled: true, threshold: 6 },
  { key: "price_target", enabled: true, threshold: null },
  { key: "monthly_checkin", enabled: true, threshold: 10 },
  { key: "goal_overdue", enabled: true, threshold: null },
  { key: "data_incomplete", enabled: true, threshold: null },
  { key: "governance_review", enabled: true, threshold: null },
] as const;
const VALID_KEYS = new Set(DEFAULTS.map((x) => x.key));

function serializeRule(row: any) {
  return {
    key: String(row.rule_key),
    enabled: Boolean(row.enabled),
    threshold: row.threshold == null ? null : Number(row.threshold),
    updatedAt: row.updated_at,
  };
}
function serializeEvent(row: any) {
  return {
    id: Number(row.id),
    key: String(row.rule_key),
    title: row.title || "",
    message: row.message || "",
    detail: row.detail || "",
    fingerprint: row.fingerprint || "",
    createdAt: row.created_at,
  };
}
async function readAll(portfolioId: number) {
  const db = getDatabase();
  const ruleRows = await db.sql`
    SELECT rule_key, enabled, threshold, updated_at
    FROM portfolio_rules
    WHERE portfolio_id = ${portfolioId}
  ` as any[];
  const byKey = new Map(ruleRows.map((x) => [String(x.rule_key), serializeRule(x)]));
  const rules = DEFAULTS.map((d) => byKey.get(d.key) || { ...d, updatedAt: null });
  const eventRows = await db.sql`
    SELECT id, rule_key, title, message, detail, fingerprint, created_at
    FROM rule_events
    WHERE portfolio_id = ${portfolioId}
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  ` as any[];
  return { rules, history: eventRows.map(serializeEvent) };
}

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();

  if (req.method === "GET") return json(await readAll(portfolioId));

  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
    if (!Array.isArray(body.rules)) return json({ error: "Lista de regras inválida." }, 400);
    for (const item of body.rules.slice(0, 20)) {
      const key = String(item?.key || "");
      if (!VALID_KEYS.has(key as any)) continue;
      const enabled = item?.enabled !== false;
      const raw = item?.threshold;
      const threshold = raw == null || raw === "" ? null : Math.max(0, Number(raw) || 0);
      await db.sql`
        INSERT INTO portfolio_rules (portfolio_id, rule_key, enabled, threshold)
        VALUES (${portfolioId}, ${key}, ${enabled}, ${threshold})
        ON CONFLICT (portfolio_id, rule_key) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          threshold = EXCLUDED.threshold,
          updated_at = NOW()
      `;
    }
    await logActivity(portfolioId, "updated", "decision_rules", "Regras automáticas", { count: body.rules.length });
    return json(await readAll(portfolioId));
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
    if (!Array.isArray(body.events)) return json({ error: "Lista de eventos inválida." }, 400);
    for (const item of body.events.slice(0, 30)) {
      const key = String(item?.key || "");
      if (!VALID_KEYS.has(key as any)) continue;
      const title = cleanText(item?.title, 160);
      const message = cleanText(item?.message, 500);
      const detail = cleanText(item?.detail, 500);
      const fingerprint = cleanText(item?.fingerprint, 500) || `${new Date().toISOString().slice(0, 10)}:${key}:${message}`;
      await db.sql`
        INSERT INTO rule_events (portfolio_id, rule_key, title, message, detail, fingerprint)
        VALUES (${portfolioId}, ${key}, ${title}, ${message}, ${detail}, ${fingerprint})
        ON CONFLICT (portfolio_id, fingerprint) DO NOTHING
      `;
    }
    return json(await readAll(portfolioId));
  }

  return json({ error: "Método não permitido." }, 405);
};

export const config: Config = { path: "/api/decision-rules" };
