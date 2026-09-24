import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { getPortfolioForUser } from "../lib/data.js";
import { json } from "../lib/http.js";

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const db = getDatabase();
  const rows = await db.sql`
    SELECT id, action, entity_type, entity_label, details, created_at
    FROM activity_log
    WHERE portfolio_id = ${portfolio.id}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return json({ history: rows });
};

export const config: Config = { path: "/api/history" };
