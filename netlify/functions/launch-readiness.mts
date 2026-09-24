import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { getPortfolioForUser } from "../lib/data.js";
import { json } from "../lib/http.js";

function activeCases(raw:any){
  const rows=Array.isArray(raw)?raw:[];
  return rows.filter((x:any)=>x&&['OPEN','INVESTIGATING'].includes(String(x.status||''))).length;
}

export default async(req:Request,_context:Context)=>{
  if(req.method!=="GET")return json({error:"Método não permitido."},405);
  const user=await getSessionUser(req);if(!user)return json({error:"Sessão expirada."},401);
  try{
    const db=getDatabase();const portfolio=await getPortfolioForUser(user);const url=new URL(req.url);const host=req.headers.get('host')||url.host;
    const [dep,security,backup,userRows,reconciliation]=await Promise.all([
      db.sql`SELECT setup_completed_at,release_version FROM deployment_state WHERE id=1 LIMIT 1` as any,
      db.sql`SELECT idle_enabled,background_logout,auto_backup_enabled,backup_frequency FROM user_security_settings WHERE user_id=${user.id} LIMIT 1` as any,
      db.sql`SELECT created_at,label FROM account_backups WHERE user_id=${user.id} ORDER BY created_at DESC,id DESC LIMIT 1` as any,
      db.sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE password_hash LIKE 'disabled$%')::int AS disabled FROM users` as any,
      portfolio?db.sql`SELECT cases FROM reconciliation_center WHERE portfolio_id=${Number(portfolio.id)} LIMIT 1` as any:Promise.resolve([] as any)
    ]);
    const release=String(dep[0]?.release_version||'');const latestBackup=backup[0]?.created_at?new Date(backup[0].created_at):null;const ageDays=latestBackup?Math.max(0,(Date.now()-latestBackup.getTime())/86400000):null;const cases=activeCases(reconciliation[0]?.cases);const production=!host.includes('localhost')&&!host.includes('127.0.0.1');const https=url.protocol==='https:';const setupComplete=Boolean(dep[0]?.setup_completed_at)&&Number(userRows[0]?.disabled||0)===0;const sec=security[0]||{};
    const checks=[
      {key:'release',title:'Release alinhada',ok:release==='2.4.0',detail:release?`Banco reporta ${release}.`:'Release não encontrada no deployment_state.'},
      {key:'https',title:'HTTPS ativo',ok:https&&production,detail:https?(production?'Conexão criptografada em ambiente publicado.':'HTTPS local detectado; falta validar o host publicado.'):'Conexão sem HTTPS.'},
      {key:'database',title:'Banco persistente',ok:true,detail:'Postgres respondeu à verificação autenticada.'},
      {key:'setup',title:'Setup único concluído',ok:setupComplete,detail:setupComplete?'Contas iniciais ativadas; credenciais desabilitadas não permanecem ativas.':'Primeiro setup ainda não foi concluído.'},
      {key:'session',title:'Proteções de sessão',ok:Boolean(sec.idle_enabled&&sec.background_logout),detail:sec.idle_enabled&&sec.background_logout?'Inatividade e logout em segundo plano configurados.':'Revise as proteções de sessão no Centro de Segurança.'},
      {key:'backup',title:'Backup recente',ok:ageDays!=null&&ageDays<=8,detail:ageDays==null?'Nenhum backup real criado para este perfil.':ageDays<=8?`Último backup há ${Math.floor(ageDays)} dia(s).`:`Último backup há ${Math.floor(ageDays)} dias.`},
      {key:'isolation',title:'Carteira isolada por usuário',ok:Boolean(portfolio),detail:portfolio?'Carteira autenticada vinculada ao usuário atual.':'Carteira não encontrada para o usuário.'},
      {key:'reconciliation',title:'Casos críticos tratados',ok:cases===0,detail:cases?`${cases} caso(s) de conciliação ainda ativo(s).`:'Nenhum caso de conciliação ativo.'}
    ];
    return json({version:'2.4.0',round:36,environment:production?'production':'local',siteUrl:`${url.protocol}//${host}`,checkedAt:new Date().toISOString(),checks});
  }catch(e){return json({error:'Não foi possível concluir o gate de produção.',detail:e instanceof Error?e.message:'Erro desconhecido.'},503)}
};
export const config:Config={path:'/api/launch-readiness'};
