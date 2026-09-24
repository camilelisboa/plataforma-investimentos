import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, logActivity, validDateOnly } from "../lib/data.js";
import { json } from "../lib/http.js";

const CATEGORIES = new Set(["RESERVE","TRAVEL","PROPERTY","RETIREMENT","EDUCATION","OTHER"]);
function serialize(row:any){return {id:Number(row.id),title:row.title,category:row.category,targetAmount:asNumber(row.target_amount),currentAmount:asNumber(row.current_amount),targetDate:row.target_date||null,notes:row.notes||"",active:Boolean(row.active)}}

export default async (req:Request,_context:Context)=>{
  const user=await getSessionUser(req); if(!user)return json({error:"Sessão expirada."},401);
  const portfolio=await getPortfolioForUser(user); if(!portfolio)return json({error:"Carteira não encontrada."},404);
  const portfolioId=Number(portfolio.id),db=getDatabase();
  if(req.method==="GET"){const rows=await db.sql`SELECT * FROM financial_goals WHERE portfolio_id=${portfolioId} AND active=TRUE ORDER BY target_date NULLS LAST, id DESC`;return json({goals:(rows as any[]).map(serialize)});}
  let body:any;try{body=await req.json();}catch{return json({error:"Dados inválidos."},400)}
  if(req.method==="POST"){
    const title=cleanText(body.title,120),category=CATEGORIES.has(String(body.category))?String(body.category):"OTHER",target=asNumber(body.targetAmount,-1),current=asNumber(body.currentAmount,0),targetDate=body.targetDate?String(body.targetDate):null,notes=cleanText(body.notes,800);
    if(!title)return json({error:"Informe o nome da meta."},400); if(target<0||current<0)return json({error:"Valores inválidos."},400); if(targetDate&&!validDateOnly(targetDate))return json({error:"Data inválida."},400);
    const rows=await db.sql`INSERT INTO financial_goals(portfolio_id,title,category,target_amount,current_amount,target_date,notes) VALUES(${portfolioId},${title},${category},${target},${current},${targetDate},${notes}) RETURNING *`;
    await logActivity(portfolioId,"created","financial_goal",title,{target});return json({goal:serialize(rows[0])},201);
  }
  const id=Math.trunc(asNumber(body.id,0)); if(!id)return json({error:"Meta inválida."},400);
  const existing=(await db.sql`SELECT * FROM financial_goals WHERE id=${id} AND portfolio_id=${portfolioId} LIMIT 1`)[0] as any; if(!existing)return json({error:"Meta não encontrada."},404);
  if(req.method==="PATCH"){
    const title=cleanText(body.title??existing.title,120),category=CATEGORIES.has(String(body.category??existing.category))?String(body.category??existing.category):existing.category,target=asNumber(body.targetAmount??existing.target_amount,-1),current=asNumber(body.currentAmount??existing.current_amount,-1),targetDate=body.targetDate===""?null:(body.targetDate??existing.target_date),notes=cleanText(body.notes??existing.notes,800);
    if(!title||target<0||current<0)return json({error:"Revise os dados da meta."},400); if(targetDate&&!validDateOnly(String(targetDate).slice(0,10)))return json({error:"Data inválida."},400);
    const rows=await db.sql`UPDATE financial_goals SET title=${title},category=${category},target_amount=${target},current_amount=${current},target_date=${targetDate},notes=${notes},updated_at=NOW() WHERE id=${id} AND portfolio_id=${portfolioId} RETURNING *`;
    await logActivity(portfolioId,"updated","financial_goal",title,{target,current});return json({goal:serialize(rows[0])});
  }
  if(req.method==="DELETE"){await db.sql`UPDATE financial_goals SET active=FALSE,updated_at=NOW() WHERE id=${id} AND portfolio_id=${portfolioId}`;await logActivity(portfolioId,"deleted","financial_goal",existing.title,{});return json({ok:true});}
  return json({error:"Método não permitido."},405);
};
export const config:Config={path:"/api/financial-goals"};
