import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { asNumber, cleanText, getPortfolioForUser, logActivity, validDateOnly } from "../lib/data.js";
import { json } from "../lib/http.js";
const CATS=new Set(["ECONOMIC","CORPORATE","PERSONAL"]);
function serialize(r:any){return {id:Number(r.id),eventDate:r.event_date,category:r.category,title:r.title,description:r.description||"",sourceUrl:r.source_url||""}}
export default async(req:Request,_context:Context)=>{const user=await getSessionUser(req);if(!user)return json({error:"Sessão expirada."},401);const portfolio=await getPortfolioForUser(user);if(!portfolio)return json({error:"Carteira não encontrada."},404);const portfolioId=Number(portfolio.id),db=getDatabase();
 if(req.method==="GET"){const rows=await db.sql`SELECT * FROM finance_calendar_events WHERE portfolio_id=${portfolioId} ORDER BY event_date ASC,id ASC LIMIT 100`;return json({events:(rows as any[]).map(serialize)});}
 let body:any;try{body=await req.json()}catch{return json({error:"Dados inválidos."},400)}
 if(req.method==="POST"){const eventDate=String(body.eventDate||""),category=CATS.has(String(body.category))?String(body.category):"ECONOMIC",title=cleanText(body.title,140),description=cleanText(body.description,900),sourceUrl=cleanText(body.sourceUrl,500);if(!validDateOnly(eventDate)||!title)return json({error:"Informe uma data e um título válidos."},400);const rows=await db.sql`INSERT INTO finance_calendar_events(portfolio_id,event_date,category,title,description,source_url) VALUES(${portfolioId},${eventDate},${category},${title},${description},${sourceUrl}) RETURNING *`;await logActivity(portfolioId,"created","calendar_event",title,{eventDate,category});return json({event:serialize(rows[0])},201);}
 const id=Math.trunc(asNumber(body.id,0));if(!id)return json({error:"Evento inválido."},400);const ex=(await db.sql`SELECT * FROM finance_calendar_events WHERE id=${id} AND portfolio_id=${portfolioId} LIMIT 1`)[0] as any;if(!ex)return json({error:"Evento não encontrado."},404);
 if(req.method==="PATCH"){const eventDate=String(body.eventDate??String(ex.event_date).slice(0,10)),category=CATS.has(String(body.category??ex.category))?String(body.category??ex.category):ex.category,title=cleanText(body.title??ex.title,140),description=cleanText(body.description??ex.description,900),sourceUrl=cleanText(body.sourceUrl??ex.source_url,500);if(!validDateOnly(eventDate)||!title)return json({error:"Revise os dados do evento."},400);const rows=await db.sql`UPDATE finance_calendar_events SET event_date=${eventDate},category=${category},title=${title},description=${description},source_url=${sourceUrl},updated_at=NOW() WHERE id=${id} AND portfolio_id=${portfolioId} RETURNING *`;await logActivity(portfolioId,"updated","calendar_event",title,{eventDate,category});return json({event:serialize(rows[0])});}
 if(req.method==="DELETE"){await db.sql`DELETE FROM finance_calendar_events WHERE id=${id} AND portfolio_id=${portfolioId}`;await logActivity(portfolioId,"deleted","calendar_event",ex.title,{});return json({ok:true});}
 return json({error:"Método não permitido."},405);
};
export const config:Config={path:"/api/calendar-events"};
