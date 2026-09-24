import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, logActivity, validDateOnly } from "../lib/data.js";
import { json } from "../lib/http.js";

const CATEGORIES = new Set(["REVIEW","THESIS","PLANNED_BUY","PLANNED_SELL","OBSERVATION"]);
const STATUSES = new Set(["OPEN","WATCH","CLOSED"]);

function serializePolicy(row:any){
  if(!row)return {objective:"",horizonYears:10,reviewFrequencyMonths:6,maxAssetWeightPct:20,minCashPct:5,liquidityNote:"",principles:"",restrictedAssets:"",stressShocks:{},updatedAt:null};
  return {objective:row.objective||"",horizonYears:asNumber(row.horizon_years,10),reviewFrequencyMonths:Math.max(1,Math.trunc(asNumber(row.review_frequency_months,6))),maxAssetWeightPct:asNumber(row.max_asset_weight_pct,20),minCashPct:asNumber(row.min_cash_pct,5),liquidityNote:row.liquidity_note||"",principles:row.principles||"",restrictedAssets:row.restricted_assets||"",stressShocks:row.stress_shocks&&typeof row.stress_shocks==='object'?row.stress_shocks:{},updatedAt:row.updated_at||null};
}
function serializeJournal(row:any){return {id:Number(row.id),decisionDate:row.decision_date,category:row.category,symbol:row.symbol||null,title:row.title,rationale:row.rationale||"",triggerNote:row.trigger_note||"",reviewDate:row.review_date||null,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at};}
async function readAll(portfolioId:number){const db=getDatabase();const policyRows=await db.sql`SELECT * FROM portfolio_governance WHERE portfolio_id=${portfolioId} LIMIT 1`;const journalRows=await db.sql`SELECT * FROM decision_journal WHERE portfolio_id=${portfolioId} AND active=TRUE ORDER BY decision_date DESC,id DESC`;return {policy:serializePolicy(policyRows[0]),journal:(journalRows as any[]).map(serializeJournal)};}
function cleanShocks(value:any){const out:Record<string,number>={};if(!value||typeof value!=="object")return out;for(const [k,v] of Object.entries(value)){const key=cleanText(k,80);const n=Number(v);if(key&&Number.isFinite(n))out[key]=Math.max(-1000,Math.min(1000,n));}return out;}

export default async (req:Request,_context:Context)=>{
  const user=await getSessionUser(req);if(!user)return json({error:"Sessão expirada."},401);
  const portfolio=await getPortfolioForUser(user);if(!portfolio)return json({error:"Carteira não encontrada."},404);
  const portfolioId=Number(portfolio.id),db=getDatabase();
  if(req.method==="GET")return json(await readAll(portfolioId));
  let body:any;try{body=await req.json();}catch{return json({error:"Dados inválidos."},400)}
  if(req.method==="PUT"){
    const objective=cleanText(body.objective,900),horizonYears=Math.max(0,asNumber(body.horizonYears,10)),reviewFrequencyMonths=Math.max(1,Math.min(120,Math.trunc(asNumber(body.reviewFrequencyMonths,6)))),maxAssetWeightPct=Math.max(0,Math.min(100,asNumber(body.maxAssetWeightPct,20))),minCashPct=Math.max(0,Math.min(100,asNumber(body.minCashPct,5))),liquidityNote=cleanText(body.liquidityNote,700),principles=cleanText(body.principles,1500),restrictedAssets=cleanText(body.restrictedAssets,1000),stressShocks=cleanShocks(body.stressShocks);
    const rows=await db.sql`INSERT INTO portfolio_governance(portfolio_id,objective,horizon_years,review_frequency_months,max_asset_weight_pct,min_cash_pct,liquidity_note,principles,restricted_assets,stress_shocks) VALUES(${portfolioId},${objective},${horizonYears},${reviewFrequencyMonths},${maxAssetWeightPct},${minCashPct},${liquidityNote},${principles},${restrictedAssets},${JSON.stringify(stressShocks)}::jsonb) ON CONFLICT(portfolio_id) DO UPDATE SET objective=EXCLUDED.objective,horizon_years=EXCLUDED.horizon_years,review_frequency_months=EXCLUDED.review_frequency_months,max_asset_weight_pct=EXCLUDED.max_asset_weight_pct,min_cash_pct=EXCLUDED.min_cash_pct,liquidity_note=EXCLUDED.liquidity_note,principles=EXCLUDED.principles,restricted_assets=EXCLUDED.restricted_assets,stress_shocks=EXCLUDED.stress_shocks,updated_at=NOW() RETURNING *`;
    await logActivity(portfolioId,"updated","governance_policy","Mandato da carteira",{});return json({policy:serializePolicy(rows[0])});
  }
  if(req.method==="POST"){
    const decisionDate=String(body.decisionDate||""),category=CATEGORIES.has(String(body.category))?String(body.category):"OBSERVATION",symbol=cleanText(body.symbol,32)||null,title=cleanText(body.title,160),rationale=cleanText(body.rationale,1600),triggerNote=cleanText(body.triggerNote,900),reviewDate=body.reviewDate?String(body.reviewDate):null,status=STATUSES.has(String(body.status))?String(body.status):"OPEN";
    if(!validDateOnly(decisionDate)||!title)return json({error:"Informe data e título válidos."},400);if(reviewDate&&!validDateOnly(reviewDate))return json({error:"Data de revisão inválida."},400);
    const rows=await db.sql`INSERT INTO decision_journal(portfolio_id,decision_date,category,symbol,title,rationale,trigger_note,review_date,status) VALUES(${portfolioId},${decisionDate},${category},${symbol},${title},${rationale},${triggerNote},${reviewDate},${status}) RETURNING *`;await logActivity(portfolioId,"created","decision_journal",title,{category,symbol});return json({item:serializeJournal(rows[0])},201);
  }
  const id=Math.trunc(asNumber(body.id,0));if(!id)return json({error:"Registro inválido."},400);const existing=(await db.sql`SELECT * FROM decision_journal WHERE id=${id} AND portfolio_id=${portfolioId} AND active=TRUE LIMIT 1`)[0] as any;if(!existing)return json({error:"Registro não encontrado."},404);
  if(req.method==="PATCH"){
    const decisionDate=String(body.decisionDate??existing.decision_date).slice(0,10),category=CATEGORIES.has(String(body.category??existing.category))?String(body.category??existing.category):existing.category,symbol=cleanText(body.symbol??existing.symbol,32)||null,title=cleanText(body.title??existing.title,160),rationale=cleanText(body.rationale??existing.rationale,1600),triggerNote=cleanText(body.triggerNote??existing.trigger_note,900),reviewDate=body.reviewDate===""?null:(body.reviewDate??existing.review_date),status=STATUSES.has(String(body.status??existing.status))?String(body.status??existing.status):existing.status;
    if(!validDateOnly(decisionDate)||!title)return json({error:"Revise os dados do registro."},400);if(reviewDate&&!validDateOnly(String(reviewDate).slice(0,10)))return json({error:"Data de revisão inválida."},400);
    const rows=await db.sql`UPDATE decision_journal SET decision_date=${decisionDate},category=${category},symbol=${symbol},title=${title},rationale=${rationale},trigger_note=${triggerNote},review_date=${reviewDate},status=${status},updated_at=NOW() WHERE id=${id} AND portfolio_id=${portfolioId} RETURNING *`;await logActivity(portfolioId,"updated","decision_journal",title,{status});return json({item:serializeJournal(rows[0])});
  }
  if(req.method==="DELETE"){await db.sql`UPDATE decision_journal SET active=FALSE,updated_at=NOW() WHERE id=${id} AND portfolio_id=${portfolioId}`;await logActivity(portfolioId,"deleted","decision_journal",existing.title,{});return json({ok:true});}
  return json({error:"Método não permitido."},405);
};
export const config:Config={path:"/api/governance"};
