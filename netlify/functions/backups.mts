import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { getPortfolioForUser, cleanText } from "../lib/data.js";
import { createUserBackup } from "../lib/vault.js";
import { json } from "../lib/http.js";

function backupRow(row:any){return {id:Number(row.id),label:row.label,sizeBytes:Number(row.size_bytes||0),createdAt:row.created_at};}

async function listBackups(userId:number){const db=getDatabase();const rows=await db.sql`SELECT id,label,size_bytes,created_at FROM account_backups WHERE user_id=${userId} ORDER BY created_at DESC,id DESC LIMIT 10` as any[];return rows.map(backupRow);}

export default async(req:Request,_context:Context)=>{
  const user=await getSessionUser(req);if(!user)return json({error:'Sessão expirada.'},401);const db=getDatabase();
  if(req.method==='GET'){
    const id=Number(new URL(req.url).searchParams.get('id')||0);
    if(id){const rows=await db.sql`SELECT id,label,snapshot,size_bytes,created_at FROM account_backups WHERE id=${id} AND user_id=${user.id} LIMIT 1` as any[];if(!rows[0])return json({error:'Backup não encontrado.'},404);return json({backup:backupRow(rows[0]),snapshot:rows[0].snapshot});}
    return json({backups:await listBackups(user.id)});
  }
  if(req.method==='POST'){
    let body:any={};try{body=await req.json();}catch{}
    const portfolio=await getPortfolioForUser(user);if(!portfolio)return json({error:'Carteira não encontrada.'},404);
    const label=cleanText(body.label||'Backup manual',80)||'Backup manual';await createUserBackup(user,portfolio,label,'MANUAL',null);
    await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${user.id},'BACKUP_CREATED',${label},${(req.headers.get('user-agent')||'').slice(0,300)})`;
    const audit=await db.sql`SELECT id,event_type,detail,user_agent,created_at FROM security_audit WHERE user_id=${user.id} ORDER BY created_at DESC,id DESC LIMIT 30` as any[];
    return json({backups:await listBackups(user.id),audit:audit.map((r:any)=>({id:Number(r.id),eventType:r.event_type,detail:r.detail||'',userAgent:r.user_agent||'',createdAt:r.created_at}))},201);
  }
  return json({error:'Método não permitido.'},405);
};
export const config:Config={path:'/api/backups'};
