import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, hashSessionToken, makePasswordHash, verifyPassword } from "../lib/auth.js";
import { parseCookies, json } from "../lib/http.js";
export default async(req:Request,_context:Context)=>{
 if(req.method!=='POST')return json({error:'Método não permitido.'},405);const user=await getSessionUser(req);if(!user)return json({error:'Sessão expirada.'},401);let body:any;try{body=await req.json()}catch{return json({error:'Dados inválidos.'},400)}
 const currentPassword=typeof body.currentPassword==='string'?body.currentPassword:'';const newPassword=typeof body.newPassword==='string'?body.newPassword:'';if(newPassword.length<8||newPassword.length>128)return json({error:'A nova senha deve ter pelo menos 8 caracteres.'},400);
 const db=getDatabase();const rows=await db.sql`SELECT password_hash FROM users WHERE id=${user.id} LIMIT 1` as any[];const currentHash=rows[0]?.password_hash;if(!currentHash||!verifyPassword(currentPassword,currentHash))return json({error:'Senha atual incorreta.'},401);
 await db.sql`UPDATE users SET password_hash=${makePasswordHash(newPassword)},must_change_password=FALSE,failed_login_count=0,locked_until=NULL WHERE id=${user.id}`;
 const token=parseCookies(req).portfolio_session||'';const tokenHash=token?hashSessionToken(token):'';await db.sql`DELETE FROM sessions WHERE user_id=${user.id} AND token_hash<>${tokenHash}`;
 await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${user.id},'PASSWORD_CHANGED','Senha atualizada; demais sessões foram encerradas.',${(req.headers.get('user-agent')||'').slice(0,300)})`;
 return json({ok:true,otherSessionsRevoked:true});
};
export const config:Config={path:'/api/change-password'};
