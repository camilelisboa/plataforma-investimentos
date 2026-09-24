import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { ASSET_CLASSES, asNumber, cleanText, effectivePrice, getPortfolioForUser, logActivity, normalizeSymbol, upsertTodaySnapshot } from "../lib/data.js";
import { json } from "../lib/http.js";

function serialize(row: any) {
  const quantity = asNumber(row.quantity);
  const averagePrice = asNumber(row.average_price);
  const price = effectivePrice(row);
  const currentValue = quantity * price;
  const investedValue = quantity * averagePrice;
  return {
    id: Number(row.id),
    symbol: row.symbol,
    name: row.name,
    assetClass: row.asset_class,
    assetType: row.asset_type,
    quantity,
    averagePrice,
    manualPrice: row.manual_price == null ? null : asNumber(row.manual_price),
    targetPct: asNumber(row.target_pct),
    autoQuote: Boolean(row.auto_quote),
    marketPrice: row.market_price == null ? null : asNumber(row.market_price),
    marketChangePct: row.market_change_pct == null ? null : asNumber(row.market_change_pct),
    marketPriceAt: row.market_price_at,
    quoteSource: row.quote_source,
    notes: row.notes || "",
    effectivePrice: price,
    currentValue,
    investedValue,
    profitLoss: currentValue - investedValue,
    profitLossPct: investedValue > 0 ? ((currentValue - investedValue) / investedValue) * 100 : 0,
  };
}

async function list(portfolioId: number) {
  const db = getDatabase();
  const rows = await db.sql`
    SELECT * FROM assets
    WHERE portfolio_id = ${portfolioId} AND active = TRUE
    ORDER BY asset_class, symbol
  `;
  return rows.map(serialize);
}

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const db = getDatabase();

  if (req.method === "GET") {
    return json({ assets: await list(portfolioId), classes: ASSET_CLASSES });
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }

  if (req.method === "POST") {
    const symbol = normalizeSymbol(cleanText(body.symbol, 32));
    const name = cleanText(body.name, 100) || symbol;
    const assetClass = cleanText(body.assetClass, 40);
    const assetType = cleanText(body.assetType, 40) || assetClass || "Outro";
    const quantity = asNumber(body.quantity, -1);
    const averagePrice = asNumber(body.averagePrice, -1);
    const manualPrice = body.manualPrice === "" || body.manualPrice == null ? null : asNumber(body.manualPrice, -1);
    const targetPct = asNumber(body.targetPct, 0);
    const autoQuote = Boolean(body.autoQuote);
    const notes = cleanText(body.notes, 800);

    if (!symbol || !/^[A-Z0-9._-]+$/.test(symbol)) return json({ error: "Informe um código de ativo válido." }, 400);
    if (!ASSET_CLASSES.includes(assetClass as any)) return json({ error: "Classe de ativo inválida." }, 400);
    if (quantity < 0 || averagePrice < 0 || targetPct < 0 || targetPct > 100 || (manualPrice != null && manualPrice < 0)) {
      return json({ error: "Revise quantidade, preços e meta." }, 400);
    }

    try {
      const rows = await db.sql`
        INSERT INTO assets (
          portfolio_id, symbol, name, asset_class, asset_type, quantity,
          average_price, manual_price, target_pct, auto_quote, notes
        ) VALUES (
          ${portfolioId}, ${symbol}, ${name}, ${assetClass}, ${assetType}, ${quantity},
          ${averagePrice}, ${manualPrice}, ${targetPct}, ${autoQuote}, ${notes}
        )
        RETURNING *
      `;
      await logActivity(portfolioId, "created", "asset", symbol, { name, assetClass, quantity, averagePrice, targetPct });
      await upsertTodaySnapshot(portfolioId);
      return json({ asset: serialize(rows[0]) }, 201);
    } catch (error: any) {
      if (String(error?.message || "").toLowerCase().includes("unique")) return json({ error: "Esse ativo já está cadastrado." }, 409);
      throw error;
    }
  }

  const id = Math.trunc(asNumber(body.id, 0));
  if (!id) return json({ error: "Ativo inválido." }, 400);

  const existingRows = await db.sql`
    SELECT * FROM assets WHERE id = ${id} AND portfolio_id = ${portfolioId} AND active = TRUE LIMIT 1
  `;
  const existing = existingRows[0] as any;
  if (!existing) return json({ error: "Ativo não encontrado." }, 404);

  if (req.method === "PATCH") {
    const symbol = normalizeSymbol(cleanText(body.symbol ?? existing.symbol, 32));
    const name = cleanText(body.name ?? existing.name, 100) || symbol;
    const assetClass = cleanText(body.assetClass ?? existing.asset_class, 40);
    const assetType = cleanText(body.assetType ?? existing.asset_type, 40) || assetClass;
    const quantity = asNumber(body.quantity ?? existing.quantity, -1);
    const averagePrice = asNumber(body.averagePrice ?? existing.average_price, -1);
    const manualRaw = body.manualPrice === "" ? null : (body.manualPrice ?? existing.manual_price);
    const manualPrice = manualRaw == null ? null : asNumber(manualRaw, -1);
    const targetPct = asNumber(body.targetPct ?? existing.target_pct, 0);
    const autoQuote = body.autoQuote == null ? Boolean(existing.auto_quote) : Boolean(body.autoQuote);
    const notes = cleanText(body.notes ?? existing.notes, 800);

    if (!symbol || !/^[A-Z0-9._-]+$/.test(symbol)) return json({ error: "Código inválido." }, 400);
    if (!ASSET_CLASSES.includes(assetClass as any)) return json({ error: "Classe inválida." }, 400);
    if (quantity < 0 || averagePrice < 0 || targetPct < 0 || targetPct > 100 || (manualPrice != null && manualPrice < 0)) return json({ error: "Revise os valores." }, 400);

    const rows = await db.sql`
      UPDATE assets SET
        symbol = ${symbol}, name = ${name}, asset_class = ${assetClass}, asset_type = ${assetType},
        quantity = ${quantity}, average_price = ${averagePrice}, manual_price = ${manualPrice},
        target_pct = ${targetPct}, auto_quote = ${autoQuote}, notes = ${notes}, updated_at = NOW()
      WHERE id = ${id} AND portfolio_id = ${portfolioId}
      RETURNING *
    `;
    await logActivity(portfolioId, "updated", "asset", symbol, { quantity, averagePrice, targetPct, autoQuote });
    await upsertTodaySnapshot(portfolioId);
    return json({ asset: serialize(rows[0]) });
  }

  if (req.method === "DELETE") {
    await db.sql`UPDATE assets SET active = FALSE, updated_at = NOW() WHERE id = ${id} AND portfolio_id = ${portfolioId}`;
    await logActivity(portfolioId, "deleted", "asset", existing.symbol, { name: existing.name });
    await upsertTodaySnapshot(portfolioId);
    return json({ ok: true });
  }

  return json({ error: "Método não permitido." }, 405);
};

export const config: Config = { path: "/api/assets" };
