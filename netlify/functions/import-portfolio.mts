import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import ExcelJS from "exceljs";
import { getSessionUser } from "../lib/auth.js";
import { ASSET_CLASSES, asNumber, cleanText, getPortfolioForUser, logActivity, normalizeSymbol, upsertTodaySnapshot } from "../lib/data.js";
import { json } from "../lib/http.js";

const MAX_BYTES = 5 * 1024 * 1024;
const HEADER_ALIASES: Record<string, string> = {
  ticker: "symbol", codigo: "symbol", código: "symbol", ativo: "symbol", symbol: "symbol",
  nome: "name", name: "name",
  classe: "assetClass", "classe do ativo": "assetClass", class: "assetClass",
  tipo: "assetType", type: "assetType",
  quantidade: "quantity", qtd: "quantity", quantity: "quantity",
  "preco medio": "averagePrice", "preço médio": "averagePrice", pm: "averagePrice", averageprice: "averagePrice",
  "preco atual": "manualPrice", "preço atual": "manualPrice", "preco manual": "manualPrice", "preço manual": "manualPrice", manualprice: "manualPrice",
  meta: "targetPct", "meta %": "targetPct", "meta pct": "targetPct", targetpct: "targetPct",
  "cotacao automatica": "autoQuote", "cotação automática": "autoQuote", autoquote: "autoQuote",
  observacoes: "notes", observações: "notes", notas: "notes", notes: "notes",
};

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}
function parseLocaleNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  let text = String(value ?? "").trim();
  if (!text) return fallback;
  text = text.replace(/R\$/gi, "").replace(/%/g, "").replace(/\s/g, "");
  if (text.includes(",") && text.includes(".")) text = text.replace(/\./g, "").replace(",", ".");
  else if (text.includes(",")) text = text.replace(",", ".");
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}
function parseBool(value: unknown) {
  const v = String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  return ["1", "true", "sim", "s", "yes", "y"].includes(v);
}
function normalizeClass(value: unknown) {
  const raw = String(value ?? "").trim();
  const direct = ASSET_CLASSES.find((x) => x.toLocaleLowerCase("pt-BR") === raw.toLocaleLowerCase("pt-BR"));
  if (direct) return direct;
  const key = raw.toLocaleLowerCase("pt-BR");
  if (key.includes("fii") || key.includes("imobili")) return "FIIs";
  if (key.includes("acao") || key.includes("ação") || key.includes("acoes") || key.includes("ações")) return "Ações BR";
  if (key.includes("renda fixa") || key.includes("cdb") || key.includes("tesouro")) return "Renda Fixa";
  if (key.includes("etf")) return "ETFs";
  if (key.includes("exterior") || key.includes("internacional")) return "Exterior";
  if (key.includes("cripto")) return "Cripto";
  if (key.includes("caixa")) return "Caixa";
  return "Outros";
}

function parseCsv(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const separator = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === separator && !quoted) { row.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

async function readRows(file: File) {
  const name = file.name.toLocaleLowerCase("pt-BR");
  if (name.endsWith(".csv") || file.type.includes("csv")) return parseCsv(await file.text());
  if (!name.endsWith(".xlsx")) throw new Error("Use um arquivo .xlsx ou .csv.");
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await file.arrayBuffer());
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("A planilha não possui abas.");
  const rows: any[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r: any) => {
    rows.push((r.values as any[]).slice(1).map((v: any) => {
      if (v && typeof v === "object" && "result" in v) return v.result;
      if (v && typeof v === "object" && "text" in v) return v.text;
      return v ?? "";
    }));
  });
  return rows;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const portfolio = await getPortfolioForUser(user);
  if (!portfolio) return json({ error: "Carteira não encontrada." }, 404);
  const portfolioId = Number(portfolio.id);
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) return json({ error: "O arquivo deve ter no máximo 5 MB." }, 413);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Selecione um arquivo .xlsx ou .csv." }, 400);
  if (file.size > MAX_BYTES) return json({ error: "O arquivo deve ter no máximo 5 MB." }, 413);

  let rawRows: any[][];
  try { rawRows = await readRows(file); }
  catch (error: any) { return json({ error: error?.message || "Não foi possível ler o arquivo." }, 400); }
  if (rawRows.length < 2) return json({ error: "A planilha precisa ter cabeçalho e ao menos uma linha de dados." }, 400);

  const headers = rawRows[0].map((h) => HEADER_ALIASES[normalizeHeader(h)] || "");
  if (!headers.includes("symbol") || !headers.includes("quantity") || !headers.includes("averagePrice")) {
    return json({ error: "Cabeçalhos mínimos: Ticker/Código, Quantidade e Preço Médio." }, 400);
  }

  const entries: any[] = [];
  const errors: string[] = [];
  for (let i = 1; i < rawRows.length && entries.length < 500; i++) {
    const row = rawRows[i];
    const obj: any = {};
    headers.forEach((key, idx) => { if (key) obj[key] = row[idx]; });
    const symbol = normalizeSymbol(String(obj.symbol ?? ""));
    if (!symbol) continue;
    if (!/^[A-Z0-9._-]+$/.test(symbol)) { errors.push(`Linha ${i + 1}: código inválido.`); continue; }
    const quantity = parseLocaleNumber(obj.quantity, -1);
    const averagePrice = parseLocaleNumber(obj.averagePrice, -1);
    const manualPrice = String(obj.manualPrice ?? "").trim() === "" ? null : parseLocaleNumber(obj.manualPrice, -1);
    const targetPct = parseLocaleNumber(obj.targetPct, 0);
    if (quantity < 0 || averagePrice < 0 || (manualPrice != null && manualPrice < 0) || targetPct < 0 || targetPct > 100) {
      errors.push(`Linha ${i + 1}: valores numéricos inválidos.`); continue;
    }
    entries.push({
      symbol, name: cleanText(obj.name, 100) || symbol,
      assetClass: normalizeClass(obj.assetClass), assetType: cleanText(obj.assetType, 40) || normalizeClass(obj.assetClass),
      quantity, averagePrice, manualPrice, targetPct,
      autoQuote: obj.autoQuote === undefined || String(obj.autoQuote).trim() === "" ? false : parseBool(obj.autoQuote),
      notes: cleanText(obj.notes, 800),
    });
  }
  if (!entries.length) return json({ error: "Nenhuma linha válida encontrada.", details: errors.slice(0, 20) }, 400);

  const db = getDatabase();
  const client = await db.pool.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query("BEGIN");
    for (const item of entries) {
      const result = await client.query(
        `INSERT INTO assets (portfolio_id, symbol, name, asset_class, asset_type, quantity, average_price, manual_price, target_pct, auto_quote, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (portfolio_id, symbol) DO UPDATE SET
           name=EXCLUDED.name, asset_class=EXCLUDED.asset_class, asset_type=EXCLUDED.asset_type,
           quantity=EXCLUDED.quantity, average_price=EXCLUDED.average_price, manual_price=EXCLUDED.manual_price,
           target_pct=EXCLUDED.target_pct, auto_quote=EXCLUDED.auto_quote, notes=EXCLUDED.notes,
           active=TRUE, updated_at=NOW()
         RETURNING (xmax = 0) AS inserted`,
        [portfolioId, item.symbol, item.name, item.assetClass, item.assetType, item.quantity, item.averagePrice, item.manualPrice, item.targetPct, item.autoQuote, item.notes],
      );
      if (result.rows[0]?.inserted) inserted++; else updated++;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }

  await logActivity(portfolioId, "imported", "portfolio", file.name, { inserted, updated, ignored: errors.length });
  await upsertTodaySnapshot(portfolioId);
  return json({ ok: true, inserted, updated, ignored: errors.length, errors: errors.slice(0, 20) });
};

export const config: Config = { path: "/api/import-portfolio" };
