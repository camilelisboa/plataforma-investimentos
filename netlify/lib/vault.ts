import { getDatabase } from "@netlify/database";

export async function buildUserSnapshot(user:any, portfolio:any){
  const db=getDatabase(); const pid=Number(portfolio.id);
  const [assets,targets,transactions,income,snapshots,watchlist,finance,goals,checkins,events,planning,closings,rules,ruleEvents,governance,journal,preferences,fiscal,automation,imports,security,baselines,reconciliation]=await Promise.all([
    db.sql`SELECT * FROM assets WHERE portfolio_id=${pid} ORDER BY id`,
    db.sql`SELECT * FROM allocation_targets WHERE portfolio_id=${pid} ORDER BY id`,
    db.sql`SELECT * FROM transactions WHERE portfolio_id=${pid} ORDER BY trade_date,id`,
    db.sql`SELECT * FROM income_events WHERE portfolio_id=${pid} ORDER BY payment_date,id`,
    db.sql`SELECT * FROM portfolio_snapshots WHERE portfolio_id=${pid} ORDER BY snapshot_date,id`,
    db.sql`SELECT * FROM watchlist WHERE portfolio_id=${pid} ORDER BY id`,
    db.sql`SELECT * FROM personal_finance_profiles WHERE portfolio_id=${pid}`,
    db.sql`SELECT * FROM financial_goals WHERE portfolio_id=${pid} ORDER BY id`,
    db.sql`SELECT * FROM monthly_finance_checkins WHERE portfolio_id=${pid} ORDER BY month_date,id`,
    db.sql`SELECT * FROM finance_calendar_events WHERE portfolio_id=${pid} ORDER BY event_date,id`,
    db.sql`SELECT * FROM planning_settings WHERE portfolio_id=${pid}`,
    db.sql`SELECT * FROM monthly_closings WHERE portfolio_id=${pid} ORDER BY month_date,id`,
    db.sql`SELECT * FROM portfolio_rules WHERE portfolio_id=${pid} ORDER BY rule_key`,
    db.sql`SELECT * FROM rule_events WHERE portfolio_id=${pid} ORDER BY created_at,id`,
    db.sql`SELECT * FROM portfolio_governance WHERE portfolio_id=${pid}`,
    db.sql`SELECT * FROM decision_journal WHERE portfolio_id=${pid} ORDER BY decision_date,id`,
    db.sql`SELECT palette_key,profile_photo_data_url,pinned_sections,updated_at FROM user_preferences WHERE user_id=${user.id}`,
    db.sql`SELECT * FROM fiscal_settings WHERE portfolio_id=${pid}`,
    db.sql`SELECT * FROM automation_settings WHERE portfolio_id=${pid}`,
    db.sql`SELECT id,import_type,file_name,file_size,status,total_rows,inserted_rows,updated_rows,duplicate_rows,error_rows,apply_to_positions,details,created_at FROM import_batches WHERE portfolio_id=${pid} ORDER BY id`,
    db.sql`SELECT idle_enabled,idle_timeout_minutes,background_logout,auto_backup_enabled,backup_frequency,updated_at FROM user_security_settings WHERE user_id=${user.id}`,
    db.sql`SELECT * FROM portfolio_financial_baselines WHERE portfolio_id=${pid}`,
    db.sql`SELECT * FROM reconciliation_center WHERE portfolio_id=${pid}`
  ]);
  return {format:'pi-vault',version:24.0,generatedAt:new Date().toISOString(),user:{displayName:user.display_name,theme:user.theme},portfolio,assets,allocationTargets:targets,transactions,incomeEvents:income,portfolioSnapshots:snapshots,watchlist,personalFinance:(finance as any[])[0]||null,financialGoals:goals,financeCheckins:checkins,calendarEvents:events,planningSettings:(planning as any[])[0]||null,monthlyClosings:closings,rules,ruleEvents,governance:(governance as any[])[0]||null,decisionJournal:journal,preferences:(preferences as any[])[0]||null,fiscalSettings:(fiscal as any[])[0]||null,automationSettings:(automation as any[])[0]||null,importHistory:imports,securitySettings:(security as any[])[0]||null,financialBaselines:(baselines as any[])[0]||null,reconciliationCenter:(reconciliation as any[])[0]||null};
}

export async function createUserBackup(user:any, portfolio:any, label:string, kind:'MANUAL'|'AUTOMATIC'='MANUAL', periodKey:string|null=null){
  const db=getDatabase(); const snapshot=await buildUserSnapshot(user,portfolio); const raw=JSON.stringify(snapshot); const size=Buffer.byteLength(raw,'utf8');
  const rows=await db.sql`INSERT INTO account_backups(user_id,label,snapshot,size_bytes,backup_kind,period_key) VALUES(${user.id},${label},${raw}::jsonb,${size},${kind},${periodKey}) ON CONFLICT DO NOTHING RETURNING id,created_at`;
  await db.sql`DELETE FROM account_backups WHERE user_id=${user.id} AND id NOT IN (SELECT id FROM account_backups WHERE user_id=${user.id} ORDER BY created_at DESC,id DESC LIMIT 12)`;
  return {created:Boolean((rows as any[])[0]),row:(rows as any[])[0]||null,size};
}
