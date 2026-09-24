import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, INCOME_TYPES, logActivity, upsertTodaySnapshot, validDateOnly } from "../lib/data.js";
import { json } from "../lib/http.js";

function serialize(row: any) {
  const gross = asNumber(row.gross_amount);
  const tax = asNumber(row.tax_amount);
  return {
    id: Number(row.id), paymentDate: row.payment_date, incomeType: row.income_type,
    assetId: row.asset_id == null ? null : Number(row.asset_id), symbol: row.symbol || null,
    assetName: row.asset_name || null, grossAmount: gross, taxAmount: tax, netAmount: gross - tax,
    notes: row.notes || "", createdAt: row.created_at,
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
      SELECT i.*, a.symbol, a.name AS asset_name
      FROM income_events i LEFT JOIN assets a ON a.id = i.asset_id
      WHERE i.portfolio_id = ${portfolioId}
      ORDER BY i.payment_date DESC, i.id DESC LIMIT 300
    `;
    return json({ income: (rows as any[]).map(serialize) });
  }
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }

  const incomeType = cleanText(body.incomeType, 24).toUpperCase();
  const paymentDate = cleanText(body.paymentDate, 10);
  const gross = asNumber(body.grossAmount, -1);
  const tax = asNumber(body.taxAmount, 0);
  const notes = cleanText(body.notes, 600);
  const assetId = body.assetId ? Math.trunc(asNumber(body.assetId, 0)) : null;
  if (!INCOME_TYPES.includes(incomeType as any)) return json({ error: "Tipo de provento inválido." }, 400);
  if (!validDateOnly(paymentDate)) return json({ error: "Data inválida." }, 400);
  if (!(gross >= 0) || tax < 0 || tax > gross) return json({ error: "Revise os valores bruto e de imposto." }, 400);

  let asset: any = null;
  if (assetId) {
    const rows = await db.sql`SELECT id, symbol, name FROM assets WHERE id = ${assetId} AND portfolio_id = ${portfolioId} AND active = TRUE LIMIT 1`;
    asset = rows[0];
    if (!asset) return json({ error: "Ativo não encontrado." }, 404);
  }
  const rows = await db.sql`
    INSERT INTO income_events (portfolio_id, asset_id, income_type, payment_date, gross_amount, tax_amount, notes)
    VALUES (${portfolioId}, ${assetId}, ${incomeType}, ${paymentDate}, ${gross}, ${tax}, ${notes}) RETURNING *
  `;
  await logActivity(portfolioId, "created", "income", asset?.symbol || incomeType, { paymentDate, gross, tax, incomeType });
  await upsertTodaySnapshot(portfolioId);
  return json({ income: serialize({ ...(rows[0] as any), symbol: asset?.symbol, asset_name: asset?.name }) }, 201);
};

export const config: Config = { path: "/api/income" };
