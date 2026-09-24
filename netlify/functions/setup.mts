import type { Config, Context } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { makePasswordHash } from "../lib/auth.js";
import { json } from "../lib/http.js";
function safeEqual(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
export default async(req:Request,_context:Context)=>{
  if(req.method!=="POST")return json({error:"Método não permitido."},405);
  const configured=Netlify.env.get("PLATFORM_SETUP_TOKEN")||""; if(!configured)return json({error:"Token de configuração ainda não foi definido no ambiente publicado."},503);
  let body:any;try{body=await req.json()}catch{return json({error:"Dados inválidos."},400)}
  const token=typeof body.setupToken==='string'?body.setupToken:''; const camile=typeof body.camilePassword==='string'?body.camilePassword:''; const lucas=typeof body.lucasPassword==='string'?body.lucasPassword:'';
  if(!safeEqual(token,configured))return json({error:"Token de configuração inválido."},401);
  if(camile.length<10||camile.length>128||lucas.length<10||lucas.length>128)return json({error:"Use senhas entre 10 e 128 caracteres."},400);
  if(camile===lucas)return json({error:"Use senhas diferentes para cada usuário."},400);
  const db=getDatabase(); const state=await db.sql`SELECT setup_completed_at FROM deployment_state WHERE id=1 LIMIT 1` as any[]; if(state[0]?.setup_completed_at)return json({error:"A configuração inicial já foi concluída."},409);
  const client=await db.pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE users SET password_hash=$1,must_change_password=FALSE,failed_login_count=0,locked_until=NULL WHERE login_key='camile lisboa'`,[makePasswordHash(camile)]);await client.query(`UPDATE users SET password_hash=$1,must_change_password=FALSE,failed_login_count=0,locked_until=NULL WHERE login_key='lucas souto'`,[makePasswordHash(lucas)]);await client.query(`UPDATE deployment_state SET setup_completed_at=NOW(),release_version='2.4.0',updated_at=NOW() WHERE id=1`);await client.query(`INSERT INTO security_audit(user_id,event_type,detail,user_agent) SELECT id,'CLOUD_SETUP_COMPLETED','Configuração inicial concluída na baseline 2.4.0 · Rodada 36.',$1 FROM users`,[(req.headers.get('user-agent')||'').slice(0,300)]);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  return json({ok:true,setupComplete:true});
};
export const config:Config={path:'/api/setup'};
