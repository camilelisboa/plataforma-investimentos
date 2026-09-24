import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { json } from "../lib/http.js";
export default async(req:Request,_context:Context)=>{if(req.method!=="GET")return json({error:"Método não permitido."},405);try{const db=getDatabase();const rows=await db.sql`SELECT setup_completed_at,release_version FROM deployment_state WHERE id=1 LIMIT 1` as any[];const https=new URL(req.url).protocol==='https:';return json({ok:true,version:rows[0]?.release_version||'2.4.0',round:36,https,database:true,setupRequired:!rows[0]?.setup_completed_at,setupEnabled:Boolean(Netlify.env.get('PLATFORM_SETUP_TOKEN'))});}catch{return json({error:'Banco ainda não provisionado ou migrações pendentes.'},503)}};
export const config:Config={path:'/api/deployment-status'};
