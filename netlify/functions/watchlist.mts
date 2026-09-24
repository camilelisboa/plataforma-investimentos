import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, logActivity, normalizeSymbol } from "../lib/data.js";
import { json } from "../lib/http.js";

function serialize(row: any) {
  const marketPrice = row.market_price == null ? null : asNumber(row.market_price);
  const target = row.target_buy_price == null ? null : asNumber(row.target_buy_price);
  const changeAlert = row.alert_change_pct == null ? null : asNumber(row.alert_change_pct);
  return {
    id: Number(row.id), symbol: row.symbol, name: row.name,
    targetBuyPrice: target, alertChangePct: changeAlert, notes: row.notes || "",
    marketPrice, marketChangePct: row.market_change_pct == null ? null : asNumber(row.market_change_pct),
    marketPriceAt: row.market_price_at, quoteSource: row.quote_source,
    alertTriggered: marketPrice != null && target != null && marketPrice <= target,
    changeAlertTriggered: row.market_change_pct != null && changeAlert != null && Math.abs(asNumber(row.market_change_pct)) >= changeAlert,
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
    const rows = await db.sql`SELECT * FROM watchlist WHERE portfolio_id = ${portfolioId} ORDER BY symbol`;
    return json({ watchlist: (rows as any[]).map(serialize) });
  }
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }

  if (req.method === "POST") {
    const symbol = normalizeSymbol(cleanText(body.symbol, 32));
    const name = cleanText(body.name, 100) || symbol;
    const target = body.targetBuyPrice === "" || body.targetBuyPrice == null ? null : asNumber(body.targetBuyPrice, -1);
    const changeAlert = body.alertChangePct === "" || body.alertChangePct == null ? null : asNumber(body.alertChangePct, -1);
    const notes = cleanText(body.notes, 600);
    if (!symbol || !/^[A-Z0-9.^_-]+$/.test(symbol)) return json({ error: "Código inválido." }, 400);
    if (target != null && target < 0) return json({ error: "Preço-alvo inválido." }, 400);
    if (changeAlert != null && (changeAlert < 0 || changeAlert > 100)) return json({ error: "Alerta de oscilação deve ficar entre 0% e 100%." }, 400);
    try {
      const rows = await db.sql`
        INSERT INTO watchlist (portfolio_id, symbol, name, target_buy_price, alert_change_pct, notes)
        VALUES (${portfolioId}, ${symbol}, ${name}, ${target}, ${changeAlert}, ${notes}) RETURNING *
      `;
      await logActivity(portfolioId, "created", "watchlist", symbol, { target, changeAlert });
      return json({ item: serialize(rows[0]) }, 201);
    } catch (error: any) {
      if (String(error?.message || "").toLowerCase().includes("unique")) return json({ error: "Esse ativo já está na watchlist." }, 409);
      throw error;
    }
  }

  const id = Math.trunc(asNumber(body.id, 0));
  if (!id) return json({ error: "Item inválido." }, 400);
  const existingRows = await db.sql`SELECT * FROM watchlist WHERE id = ${id} AND portfolio_id = ${portfolioId} LIMIT 1`;
  const existing = existingRows[0] as any;
  if (!existing) return json({ error: "Item não encontrado." }, 404);

  if (req.method === "PATCH") {
    const name = cleanText(body.name ?? existing.name, 100) || existing.symbol;
    const targetRaw = body.targetBuyPrice === "" ? null : (body.targetBuyPrice ?? existing.target_buy_price);
    const target = targetRaw == null ? null : asNumber(targetRaw, -1);
    const changeAlertRaw = body.alertChangePct === "" ? null : (body.alertChangePct ?? existing.alert_change_pct);
    const changeAlert = changeAlertRaw == null ? null : asNumber(changeAlertRaw, -1);
    const notes = cleanText(body.notes ?? existing.notes, 600);
    if (target != null && target < 0) return json({ error: "Preço-alvo inválido." }, 400);
    if (changeAlert != null && (changeAlert < 0 || changeAlert > 100)) return json({ error: "Alerta de oscilação deve ficar entre 0% e 100%." }, 400);
    const rows = await db.sql`
      UPDATE watchlist SET name=${name}, target_buy_price=${target}, alert_change_pct=${changeAlert}, notes=${notes}, updated_at=NOW()
      WHERE id=${id} AND portfolio_id=${portfolioId} RETURNING *
    `;
    await logActivity(portfolioId, "updated", "watchlist", existing.symbol, { target, changeAlert });
    return json({ item: serialize(rows[0]) });
  }

  if (req.method === "DELETE") {
    await db.sql`DELETE FROM watchlist WHERE id=${id} AND portfolio_id=${portfolioId}`;
    await logActivity(portfolioId, "deleted", "watchlist", existing.symbol, {});
    return json({ ok: true });
  }
  return json({ error: "Método não permitido." }, 405);
};

export const config: Config = { path: "/api/watchlist" };
