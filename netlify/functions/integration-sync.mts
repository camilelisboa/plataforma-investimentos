import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { runIntegrationSync } from "../lib/integrations.js";

export default async()=>{
  const db=getDatabase();
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  const rows=await db.sql`SELECT portfolio_id,last_sync_at FROM integration_settings WHERE auto_sync_enabled=TRUE AND sync_hour_local=${hour}` as any[];
  for(const row of rows){
    const last=row.last_sync_at?new Date(row.last_sync_at):null;
    const now=new Date();
    if(last&&new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(last)===new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now))continue;
    try{await runIntegrationSync(Number(row.portfolio_id),'SCHEDULED');}catch(error){console.error('integration-sync',row.portfolio_id,error);}
  }
};
export const config:Config={schedule:'0 * * * *'};
