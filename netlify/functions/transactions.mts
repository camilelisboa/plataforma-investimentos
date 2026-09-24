import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, logActivity, TRANSACTION_KINDS, upsertTodaySnapshot, validDateOnly } from "../lib/data.js";
import { json } from "../lib/http.js";

function serialize(row: any) {
  return {
    id: Number(row.id),
    kind: row.kind,
    tradeDate: row.trade_date,
    assetId: row.asset_id == null ? null : Number(row.asset_id),
    symbol: row.symbol || null,
    assetName: row.asset_name || null,
    quantity: asNumber(row.quantity),
    unitPrice: asNumber(row.unit_price),
    fees: asNumber(row.fees),
    notes: row.notes || "",
    createdAt: row.created_at,
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
      SELECT t.*, a.symbol, a.name AS asset_name
      FROM transactions t
      LEFT JOIN assets a ON a.id = t.asset_id
      WHERE t.portfolio_id = ${portfolioId}
      ORDER BY t.trade_date DESC, t.id DESC
      LIMIT 300
    `;
    return json({ transactions: (rows as any[]).map(serialize) });
  }

  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }

  const kind = cleanText(body.kind, 24).toUpperCase();
  const tradeDate = cleanText(body.tradeDate, 10);
  const fees = asNumber(body.fees, 0);
  const notes = cleanText(body.notes, 600);
  if (!TRANSACTION_KINDS.includes(kind as any)) return json({ error: "Tipo de movimentação inválido." }, 400);
  if (!validDateOnly(tradeDate)) return json({ error: "Data inválida." }, 400);
  if (fees < 0) return json({ error: "Taxas não podem ser negativas." }, 400);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    if (kind === "DEPOSIT" || kind === "WITHDRAWAL") {
      const amount = asNumber(body.amount, -1);
      if (!(amount > 0)) throw new Error("VALIDATION:Informe um valor maior que zero.");
      const insert = await client.query(
        `INSERT INTO transactions (portfolio_id, kind, trade_date, quantity, unit_price, fees, notes)
         VALUES ($1,$2,$3,0,$4,$5,$6) RETURNING *`,
        [portfolioId, kind, tradeDate, amount, fees, notes],
      );
      await client.query("COMMIT");
      await logActivity(portfolioId, "created", "transaction", kind, { amount, tradeDate });
      await upsertTodaySnapshot(portfolioId);
      return json({ transaction: serialize(insert.rows[0]) }, 201);
    }

    const assetId = Math.trunc(asNumber(body.assetId, 0));
    const quantity = asNumber(body.quantity, -1);
    const unitPrice = asNumber(body.unitPrice, -1);
    if (!assetId || !(quantity > 0) || !(unitPrice > 0)) throw new Error("VALIDATION:Informe ativo, quantidade e preço válidos.");

    const assetResult = await client.query(
      "SELECT * FROM assets WHERE id = $1 AND portfolio_id = $2 AND active = TRUE FOR UPDATE",
      [assetId, portfolioId],
    );
    const asset = assetResult.rows[0];
    if (!asset) throw new Error("VALIDATION:Ativo não encontrado.");
    const oldQty = asNumber(asset.quantity);
    const oldAvg = asNumber(asset.average_price);
    let realizedResult = 0;

    if (kind === "BUY") {
      const newQty = oldQty + quantity;
      const newAvg = newQty > 0 ? ((oldQty * oldAvg) + (quantity * unitPrice) + fees) / newQty : 0;
      await client.query(
        "UPDATE assets SET quantity = $1, average_price = $2, updated_at = NOW() WHERE id = $3 AND portfolio_id = $4",
        [newQty, newAvg, assetId, portfolioId],
      );
    } else {
      if (quantity > oldQty + 1e-9) throw new Error("VALIDATION:A quantidade vendida é maior que a posição atual.");
      const newQty = Math.max(0, oldQty - quantity);
      realizedResult = (unitPrice - oldAvg) * quantity - fees;
      await client.query(
        "UPDATE assets SET quantity = $1, updated_at = NOW() WHERE id = $2 AND portfolio_id = $3",
        [newQty, assetId, portfolioId],
      );
    }

    const insert = await client.query(
      `INSERT INTO transactions (portfolio_id, asset_id, kind, trade_date, quantity, unit_price, fees, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [portfolioId, assetId, kind, tradeDate, quantity, unitPrice, fees, notes],
    );
    await client.query("COMMIT");
    await logActivity(portfolioId, "created", "transaction", `${kind} ${asset.symbol}`, { tradeDate, quantity, unitPrice, fees, realizedResult });
    await upsertTodaySnapshot(portfolioId);
    return json({ transaction: { ...serialize({ ...insert.rows[0], symbol: asset.symbol, asset_name: asset.name }), realizedResult } }, 201);
  } catch (error: any) {
    await client.query("ROLLBACK");
    const message = String(error?.message || "");
    if (message.startsWith("VALIDATION:")) return json({ error: message.slice(11) }, 400);
    throw error;
  } finally {
    client.release();
  }
};

export const config: Config = { path: "/api/transactions" };
