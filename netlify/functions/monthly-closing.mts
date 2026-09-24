import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { cleanText, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

function normalizeMonth(value: unknown) {
  const s = String(value || "");
  return /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : null;
}
function serialize(row: any) {
  return {
    id: Number(row.id),
    month: String(row.month_date).slice(0, 7),
    status: row.status === "CLOSED" ? "CLOSED" : "OPEN",
    notes: row.notes || "",
    updatedAt: row.updated_at,
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
    const rows = await db.sql`
      SELECT * FROM monthly_closings
      WHERE portfolio_id = ${portfolioId}
      ORDER BY month_date DESC
      LIMIT 60
    `;
    return json({ closings: (rows as any[]).map(serialize) });
  }

  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
    const month = normalizeMonth(body.month);
    const status = body.status === "CLOSED" ? "CLOSED" : "OPEN";
    const notes = cleanText(body.notes, 3000);
    if (!month) return json({ error: "Mês inválido." }, 400);
    const rows = await db.sql`
      INSERT INTO monthly_closings(portfolio_id, month_date, status, notes)
      VALUES(${portfolioId}, ${month}, ${status}, ${notes})
      ON CONFLICT(portfolio_id, month_date) DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `;
    await logActivity(portfolioId, "updated", "monthly_closing", String(month).slice(0, 7), { status });
    return json({ closing: serialize(rows[0]) });
  }

  return json({ error: "Método não permitido." }, 405);
};

export const config: Config = { path: "/api/monthly-closing" };
