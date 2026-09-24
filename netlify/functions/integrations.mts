import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { getPortfolioForUser, logActivity } from "../lib/data.js";
import { integrationSettings, runIntegrationSync } from "../lib/integrations.js";
import { json } from "../lib/http.js";

async function payload(portfolioId:number) {
  const db=getDatabase();
  const [settings,runs,benchmarks,events] = await Promise.all([
    integrationSettings(portfolioId),
    db.sql`SELECT id,trigger_kind,status,details,started_at,completed_at FROM integration_runs WHERE portfolio_id=${portfolioId} ORDER BY started_at DESC,id DESC LIMIT 20` as any,
    db.sql`SELECT benchmark_key,observation_date,value,source FROM benchmark_observations WHERE portfolio_id=${portfolioId} ORDER BY observation_date DESC,id DESC LIMIT 20` as any,
    db.sql`SELECT COUNT(*)::int AS count FROM finance_calendar_events WHERE portfolio_id=${portfolioId} AND integration_source IS NOT NULL AND event_date>=CURRENT_DATE` as any,
  ]);
  return {
    settings,
    providers:[
      {key:'brapi',name:'brapi.dev',role:'Cotações, proventos e benchmarks',status:Netlify.env.get('BRAPI_TOKEN')?'connected':'limited',detail:Netlify.env.get('BRAPI_TOKEN')?'Token configurado no ambiente.':'Sem token: endpoints podem operar de forma limitada.'},
      {key:'twelve',name:'Twelve Data',role:'Exterior e históricos globais',status:Netlify.env.get('TWELVE_DATA_API_KEY')?'connected':'limited',detail:Netlify.env.get('TWELVE_DATA_API_KEY')?'Chave configurada para referências e séries históricas globais.':'Configure TWELVE_DATA_API_KEY para habilitar exterior e históricos globais.'},
      {key:'finnhub',name:'Finnhub',role:'Calendário econômico e resultados',status:Netlify.env.get('FINNHUB_API_KEY')?'connected':'limited',detail:Netlify.env.get('FINNHUB_API_KEY')?'Chave configurada para calendário econômico e earnings.':'Configure FINNHUB_API_KEY para habilitar o calendário econômico real.'},
      {key:'news',name:'Google News RSS',role:'Notícias relacionadas à carteira e aos ativos do Live Desk',status:'connected',detail:'Consulta pública sob demanda; notícias não são gravadas automaticamente.'},
      {key:'db',name:'Netlify Database',role:'Persistência das sincronizações',status:'connected',detail:'Histórico, parâmetros e eventos sincronizados ficam isolados por carteira.'},
      {key:'scheduler',name:'Cloud Scheduler',role:'Sincronização automática',status:'ready',detail:'Função horária verifica o horário de Brasília configurado em cada carteira.'},
    ],
    runs:(runs as any[]).map(r=>({id:Number(r.id),triggerKind:r.trigger_kind,status:r.status,details:r.details||{},startedAt:r.started_at,completedAt:r.completed_at})),
    benchmarks:(benchmarks as any[]).map(r=>({key:r.benchmark_key,date:String(r.observation_date).slice(0,10),value:Number(r.value),source:r.source})),
    upcomingSyncedEvents:Number((events as any[])[0]?.count||0),
  };
}

export default async(req:Request,_context:Context)=>{
  const user=await getSessionUser(req); if(!user)return json({error:'Sessão expirada.'},401);
  const portfolio=await getPortfolioForUser(user); if(!portfolio)return json({error:'Carteira não encontrada.'},404);
  const portfolioId=Number(portfolio.id),db=getDatabase();
  if(req.method==='GET') return json(await payload(portfolioId));
  if(req.method==='PUT'){
    let body:any;try{body=await req.json()}catch{return json({error:'Dados inválidos.'},400)}
    const marketEnabled=body.marketEnabled!==false,agendaEnabled=body.agendaEnabled!==false,benchmarksEnabled=body.benchmarksEnabled!==false,autoSyncEnabled=body.autoSyncEnabled===true;
    const syncHourLocal=Math.max(0,Math.min(23,Math.trunc(Number(body.syncHourLocal)||0)));
    await db.sql`INSERT INTO integration_settings(portfolio_id,market_enabled,agenda_enabled,benchmarks_enabled,auto_sync_enabled,sync_hour_local) VALUES(${portfolioId},${marketEnabled},${agendaEnabled},${benchmarksEnabled},${autoSyncEnabled},${syncHourLocal}) ON CONFLICT(portfolio_id) DO UPDATE SET market_enabled=EXCLUDED.market_enabled,agenda_enabled=EXCLUDED.agenda_enabled,benchmarks_enabled=EXCLUDED.benchmarks_enabled,auto_sync_enabled=EXCLUDED.auto_sync_enabled,sync_hour_local=EXCLUDED.sync_hour_local,updated_at=NOW()`;
    await logActivity(portfolioId,'updated','integrations','Central de integrações',{marketEnabled,agendaEnabled,benchmarksEnabled,autoSyncEnabled,syncHourLocal});
    return json(await payload(portfolioId));
  }
  if(req.method==='POST'){
    const result=await runIntegrationSync(portfolioId,'MANUAL');
    await logActivity(portfolioId,'synced','integrations','Sincronização manual',result.summary);
    return json({...await payload(portfolioId),syncResult:result});
  }
  return json({error:'Método não permitido.'},405);
};
export const config:Config={path:'/api/integrations'};
