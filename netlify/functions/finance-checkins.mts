import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, logActivity } from "../lib/data.js";
import { json } from "../lib/http.js";

function normalizeMonth(v:unknown){const s=String(v||"");return /^\d{4}-\d{2}$/.test(s)?`${s}-01`:(/^\d{4}-\d{2}-\d{2}$/.test(s)?`${s.slice(0,7)}-01`:null)}
function serialize(r:any){return {id:Number(r.id),month:String(r.month_date).slice(0,7),income:asNumber(r.income),expenses:asNumber(r.expenses),invested:asNumber(r.invested),endingCash:asNumber(r.ending_cash),notes:r.notes||""}}
export default async(req:Request,_context:Context)=>{
  const user=await getSessionUser(req);if(!user)return json({error:"Sessão expirada."},401);const portfolio=await getPortfolioForUser(user);if(!portfolio)return json({error:"Carteira não encontrada."},404);const portfolioId=Number(portfolio.id),db=getDatabase();
  if(req.method==="GET"){const rows=await db.sql`SELECT * FROM monthly_finance_checkins WHERE portfolio_id=${portfolioId} ORDER BY month_date DESC LIMIT 36`;return json({checkins:(rows as any[]).map(serialize)});}
  let body:any;try{body=await req.json()}catch{return json({error:"Dados inválidos."},400)}
  if(req.method==="POST"){
    const month=normalizeMonth(body.month),income=asNumber(body.income,-1),expenses=asNumber(body.expenses,-1),invested=asNumber(body.invested,-1),endingCash=asNumber(body.endingCash,-1),notes=cleanText(body.notes,800);if(!month||[income,expenses,invested,endingCash].some(v=>v<0))return json({error:"Revise os dados do mês."},400);
    const rows=await db.sql`INSERT INTO monthly_finance_checkins(portfolio_id,month_date,income,expenses,invested,ending_cash,notes) VALUES(${portfolioId},${month},${income},${expenses},${invested},${endingCash},${notes}) ON CONFLICT(portfolio_id,month_date) DO UPDATE SET income=EXCLUDED.income,expenses=EXCLUDED.expenses,invested=EXCLUDED.invested,ending_cash=EXCLUDED.ending_cash,notes=EXCLUDED.notes,updated_at=NOW() RETURNING *`;
    await logActivity(portfolioId,"updated","finance_checkin",String(month).slice(0,7),{income,expenses,invested});return json({checkin:serialize(rows[0])});
  }
  const id=Math.trunc(asNumber(body.id,0));if(!id)return json({error:"Registro inválido."},400);const existing=(await db.sql`SELECT * FROM monthly_finance_checkins WHERE id=${id} AND portfolio_id=${portfolioId} LIMIT 1`)[0] as any;if(!existing)return json({error:"Registro não encontrado."},404);
  if(req.method==="DELETE"){await db.sql`DELETE FROM monthly_finance_checkins WHERE id=${id} AND portfolio_id=${portfolioId}`;await logActivity(portfolioId,"deleted","finance_checkin",String(existing.month_date).slice(0,7),{});return json({ok:true});}
  return json({error:"Método não permitido."},405);
};
export const config:Config={path:"/api/finance-checkins"};
