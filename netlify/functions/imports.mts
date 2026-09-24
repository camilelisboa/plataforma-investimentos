import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { getSessionUser } from "../lib/auth.js";
import { ASSET_CLASSES, cleanText, getPortfolioForUser, logActivity, normalizeSymbol, upsertTodaySnapshot } from "../lib/data.js";
import { json } from "../lib/http.js";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 1000;
type ImportType = "POSITIONS" | "TRANSACTIONS" | "INCOME";

type ParsedItem = {
  row: number;
  valid: boolean;
  error?: string;
  duplicate?: boolean;
  data: any;
};

function strip(value: unknown) {
  return String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
function parseLocaleNumber(value: unknown, fallback = NaN) {
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
  const v = strip(value);
  return ["1", "true", "sim", "s", "yes", "y"].includes(v);
}
function parseDateOnly(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000 && value < 90000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const d = new Date(excelEpoch + Math.round(value) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2,"0")}-${br[1].padStart(2,"0")}`;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10) : "";
}
function normalizeClass(value: unknown) {
  const raw = String(value ?? "").trim();
  const direct = ASSET_CLASSES.find((x) => strip(x) === strip(raw));
  if (direct) return direct;
  const key = strip(raw);
  if (key.includes("fii") || key.includes("imobili")) return "FIIs";
  if (key.includes("acao") || key.includes("acoes")) return "Ações BR";
  if (key.includes("renda fixa") || key.includes("cdb") || key.includes("tesouro")) return "Renda Fixa";
  if (key.includes("etf")) return "ETFs";
  if (key.includes("exterior") || key.includes("internacional") || key.includes("bdr")) return "Exterior";
  if (key.includes("cripto")) return "Cripto";
  if (key.includes("caixa")) return "Caixa";
  return "Outros";
}
function normalizeTransactionKind(value: unknown) {
  const v = strip(value);
  if (["buy","compra","comprar","c"].includes(v)) return "BUY";
  if (["sell","venda","vender","v"].includes(v)) return "SELL";
  if (["deposit","deposito","aporte","entrada","transferencia entrada"].includes(v)) return "DEPOSIT";
  if (["withdrawal","retirada","saque","resgate","saida","transferencia saida"].includes(v)) return "WITHDRAWAL";
  return "";
}
function normalizeIncomeType(value: unknown) {
  const v = strip(value);
  if (["dividend","dividendo","dividendos"].includes(v)) return "DIVIDEND";
  if (["jcp","juros sobre capital proprio","juros sobre capital"].includes(v)) return "JCP";
  if (["fii income","rendimento fii","rendimentos fii","fii","rendimento de fii"].includes(v)) return "FII_INCOME";
  if (["interest","juros","rendimento renda fixa"].includes(v)) return "INTEREST";
  if (["coupon","cupom"].includes(v)) return "COUPON";
  if (["other","outro","outros"].includes(v)) return "OTHER";
  return "";
}

const ALIASES: Record<string,string> = {
  ticker:"symbol", codigo:"symbol", ativo:"symbol", symbol:"symbol", papel:"symbol",
  nome:"name", name:"name", descricao:"name",
  classe:"assetClass", "classe do ativo":"assetClass", class:"assetClass",
  tipoativo:"assetType", "tipo do ativo":"assetType", categoria:"assetType",
  quantidade:"quantity", qtd:"quantity", quantity:"quantity",
  "preco medio":"averagePrice", pm:"averagePrice", averageprice:"averagePrice", "preco de aquisicao":"averagePrice",
  "preco atual":"manualPrice", "preco manual":"manualPrice", manualprice:"manualPrice",
  meta:"targetPct", "meta %":"targetPct", targetpct:"targetPct",
  "cotacao automatica":"autoQuote", autoquote:"autoQuote",
  observacoes:"notes", notas:"notes", notes:"notes", memo:"notes",
  tipo:"kindOrIncomeType", operacao:"kindOrIncomeType", movimento:"kindOrIncomeType", evento:"kindOrIncomeType",
  data:"date", "data da operacao":"date", "data operacao":"date", "data pagamento":"date", "data do pagamento":"date", date:"date",
  preco:"unitPrice", "preco unitario":"unitPrice", "valor unitario":"unitPrice", unitprice:"unitPrice",
  taxas:"fees", taxa:"fees", custos:"fees", corretagem:"fees", fees:"fees",
  valor:"amountOrGross", montante:"amountOrGross", amount:"amountOrGross", bruto:"amountOrGross", "valor bruto":"amountOrGross", gross:"amountOrGross",
  imposto:"taxAmount", ir:"taxAmount", "irrf":"taxAmount", "imposto retido":"taxAmount", tax:"taxAmount",
};

function parseCsv(text: string) {
  const firstLine = text.split(/\r?\n/,1)[0] || "";
  const separator = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (ch==='"') {
      if (quoted && text[i+1]==='"') { field+='"'; i++; } else quoted=!quoted;
    } else if (ch===separator && !quoted) { row.push(field); field=""; }
    else if ((ch==='\n'||ch==='\r') && !quoted) {
      if (ch==='\r'&&text[i+1]==='\n') i++;
      row.push(field); field="";
      if (row.some(x=>x.trim())) rows.push(row);
      row=[];
    } else field+=ch;
  }
  row.push(field); if (row.some(x=>x.trim())) rows.push(row);
  return rows;
}

async function readRows(file: File) {
  const name=file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type.includes('csv') || name.endsWith('.txt')) return parseCsv(await file.text());
  if (!name.endsWith('.xlsx')) throw new Error("Use um arquivo .xlsx ou .csv.");
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  const sheet=workbook.worksheets[0];
  if (!sheet) throw new Error("A planilha não possui abas.");
  const rows:any[][]=[];
  sheet.eachRow({includeEmpty:false},(r:any)=>{
    rows.push((r.values as any[]).slice(1).map((v:any)=>{
      if (v && typeof v==='object' && 'result' in v) return v.result;
      if (v && typeof v==='object' && 'text' in v) return v.text;
      return v ?? "";
    }));
  });
  return rows;
}

function mappedHeaders(raw:any[]) {
  return raw.map((x)=>ALIASES[strip(x)] || "");
}
function detectType(headers:string[]):ImportType|null {
  const set=new Set(headers);
  if (set.has('averagePrice') && set.has('quantity') && set.has('symbol')) return 'POSITIONS';
  if (set.has('kindOrIncomeType') && set.has('date') && set.has('taxAmount')) return 'INCOME';
  if (set.has('kindOrIncomeType') && set.has('date') && (set.has('unitPrice') || set.has('fees'))) return 'TRANSACTIONS';
  if (set.has('kindOrIncomeType') && set.has('date') && set.has('amountOrGross')) return 'TRANSACTIONS';
  return null;
}
function objFromRow(headers:string[],row:any[]) {
  const obj:any={}; headers.forEach((key,i)=>{if(key)obj[key]=row[i];}); return obj;
}
function fingerprint(type:ImportType,data:any) {
  const canonical = type==='TRANSACTIONS'
    ? [data.kind,data.date,data.symbol||'',Number(data.quantity||0).toFixed(8),Number(data.unitPrice||0).toFixed(8),Number(data.amount||0).toFixed(2),Number(data.fees||0).toFixed(2)].join('|')
    : [data.incomeType,data.date,data.symbol||'',Number(data.grossAmount||0).toFixed(2),Number(data.taxAmount||0).toFixed(2)].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

function parseItems(type:ImportType, rawRows:any[][]):ParsedItem[] {
  const headers=mappedHeaders(rawRows[0]||[]);
  const items:ParsedItem[]=[];
  for (let i=1;i<rawRows.length && items.length<MAX_ROWS;i++) {
    const obj=objFromRow(headers,rawRows[i]);
    const row=i+1;
    if (!Object.values(obj).some(v=>String(v??'').trim())) continue;
    if (type==='POSITIONS') {
      const symbol=normalizeSymbol(String(obj.symbol??''));
      const quantity=parseLocaleNumber(obj.quantity,-1), averagePrice=parseLocaleNumber(obj.averagePrice,-1);
      const manualRaw=String(obj.manualPrice??'').trim(); const manualPrice=manualRaw===''?null:parseLocaleNumber(obj.manualPrice,-1);
      const targetPct=Number.isFinite(parseLocaleNumber(obj.targetPct))?parseLocaleNumber(obj.targetPct):0;
      let error='';
      if (!symbol || !/^[A-Z0-9._-]+$/.test(symbol)) error='Ticker/código inválido.';
      else if (quantity<0 || averagePrice<0 || (manualPrice!=null&&manualPrice<0) || targetPct<0 || targetPct>100) error='Revise quantidade, preços e meta.';
      items.push({row,valid:!error,error:error||undefined,data:{symbol,name:cleanText(obj.name,100)||symbol,assetClass:normalizeClass(obj.assetClass),assetType:cleanText(obj.assetType,40)||normalizeClass(obj.assetClass),quantity,averagePrice,manualPrice,targetPct,autoQuote:String(obj.autoQuote??'').trim()===''?false:parseBool(obj.autoQuote),notes:cleanText(obj.notes,800)}});
    } else if (type==='TRANSACTIONS') {
      const kind=normalizeTransactionKind(obj.kindOrIncomeType), date=parseDateOnly(obj.date), symbol=normalizeSymbol(String(obj.symbol??''));
      const quantity=parseLocaleNumber(obj.quantity,0), unitPrice=parseLocaleNumber(obj.unitPrice,0), amount=parseLocaleNumber(obj.amountOrGross,0), fees=Math.max(0,parseLocaleNumber(obj.fees,0));
      let error='';
      if (!kind) error='Tipo de movimentação não reconhecido.';
      else if (!date) error='Data inválida.';
      else if ((kind==='BUY'||kind==='SELL') && (!symbol || !(quantity>0) || !(unitPrice>0))) error='Compra/venda exige ticker, quantidade e preço.';
      else if ((kind==='DEPOSIT'||kind==='WITHDRAWAL') && !(amount>0)) error='Aporte/retirada exige valor maior que zero.';
      const data={kind,date,symbol:(kind==='BUY'||kind==='SELL')?symbol:'',quantity,unitPrice,amount,fees,notes:cleanText(obj.notes,600)};
      items.push({row,valid:!error,error:error||undefined,data:{...data,fingerprint:fingerprint('TRANSACTIONS',data)}});
    } else {
      const incomeType=normalizeIncomeType(obj.kindOrIncomeType), date=parseDateOnly(obj.date), symbol=normalizeSymbol(String(obj.symbol??''));
      const grossAmount=parseLocaleNumber(obj.amountOrGross,-1), taxAmount=Math.max(0,parseLocaleNumber(obj.taxAmount,0));
      let error='';
      if (!incomeType) error='Tipo de provento não reconhecido.';
      else if (!date) error='Data inválida.';
      else if (!(grossAmount>=0) || taxAmount>grossAmount) error='Revise valor bruto e imposto.';
      const data={incomeType,date,symbol,grossAmount,taxAmount,notes:cleanText(obj.notes,600)};
      items.push({row,valid:!error,error:error||undefined,data:{...data,fingerprint:fingerprint('INCOME',data)}});
    }
  }
  return items;
}

async function validateReferences(portfolioId:number,type:ImportType,items:ParsedItem[]) {
  if (type==='POSITIONS') return;
  const db=getDatabase();
  const rows=await db.sql`SELECT symbol FROM assets WHERE portfolio_id=${portfolioId} AND active=TRUE` as any[];
  const symbols=new Set(rows.map(r=>String(r.symbol).toUpperCase()));
  for(const item of items){
    if(!item.valid)continue;
    const symbol=String(item.data.symbol||'').toUpperCase();
    if(symbol&&!symbols.has(symbol)){
      item.valid=false;
      item.error=`Ativo ${symbol} não existe na carteira. Importe/cadastre as posições primeiro.`;
    }
  }
}
async function markDuplicates(portfolioId:number,type:ImportType,items:ParsedItem[],guard:boolean) {
  if (!guard || type==='POSITIONS') return;
  const db=getDatabase();
  const seen=new Set<string>();
  for (const item of items) {
    if (!item.valid) continue;
    const fp=String(item.data.fingerprint||'');
    if(seen.has(fp)){item.duplicate=true;continue;}
    seen.add(fp);
    const rows=type==='TRANSACTIONS'
      ? await db.sql`SELECT 1 FROM transactions WHERE portfolio_id=${portfolioId} AND import_fingerprint=${fp} LIMIT 1`
      : await db.sql`SELECT 1 FROM income_events WHERE portfolio_id=${portfolioId} AND import_fingerprint=${fp} LIMIT 1`;
    item.duplicate=Boolean(rows[0]);
  }
}
function summarize(items:ParsedItem[]) {
  return {
    total:items.length,
    valid:items.filter(x=>x.valid&&!x.duplicate).length,
    duplicates:items.filter(x=>x.duplicate).length,
    errors:items.filter(x=>!x.valid).length,
  };
}
function previewRow(type:ImportType,item:ParsedItem) {
  const d=item.data;
  if(type==='POSITIONS') return {row:item.row,status:item.valid?'ok':'error',error:item.error||'',main:d.symbol,detail:`${d.assetClass} · ${d.quantity} un.`,value:d.averagePrice};
  if(type==='TRANSACTIONS') return {row:item.row,status:item.duplicate?'duplicate':item.valid?'ok':'error',error:item.error||'',main:d.kind+(d.symbol?` · ${d.symbol}`:''),detail:d.date,value:(d.kind==='BUY'||d.kind==='SELL')?d.quantity*d.unitPrice:d.amount};
  return {row:item.row,status:item.duplicate?'duplicate':item.valid?'ok':'error',error:item.error||'',main:d.incomeType+(d.symbol?` · ${d.symbol}`:''),detail:d.date,value:d.grossAmount};
}

async function getHistory(portfolioId:number) {
  const db=getDatabase();
  const rows=await db.sql`
    SELECT id, import_type, file_name, file_size, status, total_rows, inserted_rows, updated_rows, duplicate_rows, error_rows, apply_to_positions, created_at
    FROM import_batches WHERE portfolio_id=${portfolioId}
    ORDER BY created_at DESC, id DESC LIMIT 60
  ` as any[];
  return rows.map(r=>({id:Number(r.id),type:r.import_type,fileName:r.file_name,fileSize:Number(r.file_size||0),status:r.status,total:Number(r.total_rows||0),inserted:Number(r.inserted_rows||0),updated:Number(r.updated_rows||0),duplicates:Number(r.duplicate_rows||0),errors:Number(r.error_rows||0),applyToPositions:Boolean(r.apply_to_positions),createdAt:r.created_at}));
}

export default async (req:Request,_context:Context) => {
  const user=await getSessionUser(req); if(!user)return json({error:'Sessão expirada.'},401);
  const portfolio=await getPortfolioForUser(user); if(!portfolio)return json({error:'Carteira não encontrada.'},404);
  const portfolioId=Number(portfolio.id), db=getDatabase();
  if(req.method==='GET') return json({history:await getHistory(portfolioId)});
  if(req.method!=='POST') return json({error:'Método não permitido.'},405);
  const contentLength=Number(req.headers.get('content-length')||0); if(contentLength>MAX_BYTES+500000)return json({error:'O arquivo deve ter no máximo 8 MB.'},413);
  const form=await req.formData(); const file=form.get('file'); if(!(file instanceof File))return json({error:'Selecione um arquivo .xlsx ou .csv.'},400); if(file.size>MAX_BYTES)return json({error:'O arquivo deve ter no máximo 8 MB.'},413);
  const requested=String(form.get('importType')||'AUTO').toUpperCase(); const mode=String(form.get('mode')||'preview').toLowerCase();
  const applyToPositions=String(form.get('applyToPositions')||'false')==='true'; const duplicateGuard=String(form.get('duplicateGuard')||'true')!=='false';
  let rawRows:any[][]; try{rawRows=await readRows(file);}catch(e:any){return json({error:e?.message||'Não foi possível ler o arquivo.'},400);} if(rawRows.length<2)return json({error:'O arquivo precisa ter cabeçalho e ao menos uma linha de dados.'},400);
  const headers=mappedHeaders(rawRows[0]); const detected=detectType(headers); const type=(requested==='AUTO'?detected:requested) as ImportType|null;
  if(!type || !['POSITIONS','TRANSACTIONS','INCOME'].includes(type))return json({error:'Não foi possível identificar o tipo. Escolha Posições, Movimentações ou Proventos.'},400);
  const items=parseItems(type,rawRows); if(!items.length)return json({error:'Nenhuma linha de dados reconhecida.'},400);
  await validateReferences(portfolioId,type,items);
  await markDuplicates(portfolioId,type,items,duplicateGuard);
  const summary=summarize(items);
  if(mode!=='commit') return json({ok:true,mode:'preview',detectedType:type,summary,headers:rawRows[0].map(x=>String(x??'')),rows:items.slice(0,100).map(x=>previewRow(type,x)),truncated:items.length>100});

  let inserted=0,updated=0,duplicates=0,errors=items.filter(x=>!x.valid).length;
  const client=await db.pool.connect(); let batchId:number|undefined;
  try{
    await client.query('BEGIN');
    const batch=await client.query(
      `INSERT INTO import_batches (portfolio_id,import_type,file_name,file_size,status,total_rows,duplicate_rows,error_rows,apply_to_positions)
       VALUES ($1,$2,$3,$4,'COMPLETED',$5,0,$6,$7) RETURNING id`,
      [portfolioId,type,cleanText(file.name,240)||'arquivo',file.size,items.length,errors,applyToPositions]
    ); batchId=Number(batch.rows[0].id);
    const assetRows=await client.query('SELECT id,symbol,quantity,average_price FROM assets WHERE portfolio_id=$1 AND active=TRUE FOR UPDATE',[portfolioId]);
    const assets=new Map(assetRows.rows.map((r:any)=>[String(r.symbol).toUpperCase(),r]));
    for(const item of items){
      if(!item.valid)continue; if(item.duplicate&&duplicateGuard){duplicates++;continue;} const d=item.data;
      if(type==='POSITIONS'){
        const res=await client.query(
          `INSERT INTO assets (portfolio_id,symbol,name,asset_class,asset_type,quantity,average_price,manual_price,target_pct,auto_quote,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (portfolio_id,symbol) DO UPDATE SET name=EXCLUDED.name,asset_class=EXCLUDED.asset_class,asset_type=EXCLUDED.asset_type,quantity=EXCLUDED.quantity,average_price=EXCLUDED.average_price,manual_price=EXCLUDED.manual_price,target_pct=EXCLUDED.target_pct,auto_quote=EXCLUDED.auto_quote,notes=EXCLUDED.notes,active=TRUE,updated_at=NOW()
           RETURNING id,(xmax=0) AS inserted`,
          [portfolioId,d.symbol,d.name,d.assetClass,d.assetType,d.quantity,d.averagePrice,d.manualPrice,d.targetPct,d.autoQuote,d.notes]
        ); if(res.rows[0]?.inserted)inserted++;else updated++; continue;
      }
      if(type==='TRANSACTIONS'){
        let asset:any=null;
        if(d.kind==='BUY'||d.kind==='SELL'){
          asset=assets.get(d.symbol); if(!asset){errors++;continue;}
          if(applyToPositions){
            const oldQty=Number(asset.quantity)||0, oldAvg=Number(asset.average_price)||0;
            if(d.kind==='SELL'&&d.quantity>oldQty+1e-9){errors++;continue;}
            if(d.kind==='BUY'){
              const newQty=oldQty+d.quantity, newAvg=newQty?((oldQty*oldAvg)+(d.quantity*d.unitPrice)+d.fees)/newQty:0;
              await client.query('UPDATE assets SET quantity=$1,average_price=$2,updated_at=NOW() WHERE id=$3 AND portfolio_id=$4',[newQty,newAvg,asset.id,portfolioId]); asset.quantity=newQty;asset.average_price=newAvg;
            }else{
              const newQty=Math.max(0,oldQty-d.quantity); await client.query('UPDATE assets SET quantity=$1,updated_at=NOW() WHERE id=$2 AND portfolio_id=$3',[newQty,asset.id,portfolioId]);asset.quantity=newQty;
            }
          }
        }
        const txInsert=await client.query(
          `INSERT INTO transactions (portfolio_id,asset_id,kind,trade_date,quantity,unit_price,fees,notes,import_batch_id,import_fingerprint)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (portfolio_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL DO NOTHING
           RETURNING id`,
          [portfolioId,asset?.id||null,d.kind,d.date,(d.kind==='BUY'||d.kind==='SELL')?d.quantity:0,(d.kind==='BUY'||d.kind==='SELL')?d.unitPrice:d.amount,d.fees,d.notes,batchId,duplicateGuard?d.fingerprint:null]
        );
        if(txInsert.rowCount)inserted++;else duplicates++;
        continue;
      }
      let asset:any=null; if(d.symbol){asset=assets.get(d.symbol);if(!asset){errors++;continue;}}
      const incomeInsert=await client.query(
        `INSERT INTO income_events (portfolio_id,asset_id,income_type,payment_date,gross_amount,tax_amount,notes,import_batch_id,import_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (portfolio_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL DO NOTHING
         RETURNING id`,
        [portfolioId,asset?.id||null,d.incomeType,d.date,d.grossAmount,d.taxAmount,d.notes,batchId,duplicateGuard?d.fingerprint:null]
      );
      if(incomeInsert.rowCount)inserted++;else duplicates++;
    }
    const status=errors>0?'PARTIAL':'COMPLETED';
    await client.query('UPDATE import_batches SET status=$1,inserted_rows=$2,updated_rows=$3,duplicate_rows=$4,error_rows=$5,details=$6::jsonb WHERE id=$7',[status,inserted,updated,duplicates,errors,JSON.stringify({duplicateGuard,detectedType:type}),batchId]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  await logActivity(portfolioId,'imported','import_batch',file.name,{type,inserted,updated,duplicates,errors,applyToPositions}); await upsertTodaySnapshot(portfolioId);
  return json({ok:true,mode:'commit',detectedType:type,summary:{total:items.length,inserted,updated,duplicates,errors},history:await getHistory(portfolioId)});
};

export const config:Config={path:'/api/imports'};
