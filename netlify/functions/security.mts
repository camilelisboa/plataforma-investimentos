import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, hashSessionToken, verifyPassword } from "../lib/auth.js";
import { parseCookies, json } from "../lib/http.js";

const TIMEOUTS = new Set([5,15,30,60,120,240]);
const FREQUENCIES = new Set(["DAILY","WEEKLY","MONTHLY"]);

function ua(req: Request) { return (req.headers.get("user-agent") || "").slice(0, 300); }
function settingsRow(row: any) {
  return {
    idleEnabled: row?.idle_enabled !== false,
    idleTimeoutMinutes: Number(row?.idle_timeout_minutes || 30),
    backgroundLogout: row?.background_logout !== false,
    autoBackupEnabled: row?.auto_backup_enabled !== false,
    backupFrequency: row?.backup_frequency || "WEEKLY",
    updatedAt: row?.updated_at || null,
  };
}
function sessionRow(row: any, currentHash: string) {
  return {
    id: Number(row.id),
    current: row.token_hash === currentHash,
    userAgent: row.user_agent || "Dispositivo não identificado",
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || row.created_at,
    expiresAt: row.expires_at,
  };
}
function auditRow(row: any) {
  return { id:Number(row.id), eventType:row.event_type, detail:row.detail || "", userAgent:row.user_agent || "", createdAt:row.created_at };
}

async function loadDashboard(req: Request, user: any) {
  const db = getDatabase();
  const token = parseCookies(req).portfolio_session || "";
  const currentHash = token ? hashSessionToken(token) : "";
  const [settings, sessions, audit] = await Promise.all([
    db.sql`SELECT * FROM user_security_settings WHERE user_id=${user.id} LIMIT 1` as any,
    db.sql`SELECT id,token_hash,user_agent,created_at,last_seen_at,expires_at FROM sessions WHERE user_id=${user.id} AND expires_at>NOW() ORDER BY created_at DESC` as any,
    db.sql`SELECT id,event_type,detail,user_agent,created_at FROM security_audit WHERE user_id=${user.id} ORDER BY created_at DESC,id DESC LIMIT 30` as any,
  ]);
  return {
    settings: settingsRow(settings[0]),
    sessions: (sessions as any[]).map(r => sessionRow(r,currentHash)),
    audit: (audit as any[]).map(auditRow),
    readiness: {
      https: new URL(req.url).protocol === "https:",
      httpOnly: true,
      sameSite: true,
      rateLimit: true,
      dataIsolation: true,
      cloudDatabase: true,
    },
  };
}

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);
  const db = getDatabase();

  if (req.method === "GET") return json(await loadDashboard(req,user));

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }

  if (req.method === "PUT") {
    const idleTimeoutMinutes = Number(body.idleTimeoutMinutes);
    const backupFrequency = String(body.backupFrequency || "WEEKLY");
    if (!TIMEOUTS.has(idleTimeoutMinutes) || !FREQUENCIES.has(backupFrequency)) return json({ error: "Revise os parâmetros de segurança." }, 400);
    const idleEnabled = body.idleEnabled !== false;
    const backgroundLogout = body.backgroundLogout !== false;
    const autoBackupEnabled = body.autoBackupEnabled !== false;
    const rows = await db.sql`
      INSERT INTO user_security_settings(user_id,idle_enabled,idle_timeout_minutes,background_logout,auto_backup_enabled,backup_frequency,updated_at)
      VALUES(${user.id},${idleEnabled},${idleTimeoutMinutes},${backgroundLogout},${autoBackupEnabled},${backupFrequency},NOW())
      ON CONFLICT(user_id) DO UPDATE SET idle_enabled=EXCLUDED.idle_enabled,idle_timeout_minutes=EXCLUDED.idle_timeout_minutes,background_logout=EXCLUDED.background_logout,auto_backup_enabled=EXCLUDED.auto_backup_enabled,backup_frequency=EXCLUDED.backup_frequency,updated_at=NOW()
      RETURNING *
    ` as any[];
    await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${user.id},'SECURITY_SETTINGS_UPDATED','Política de sessão e backup atualizada.',${ua(req)})`;
    const dashboard = await loadDashboard(req,user);
    return json({ ...dashboard, settings: settingsRow(rows[0]) });
  }

  if (req.method === "POST") {
    const action = String(body.action || "");
    if (action === "verify_password") {
      const password = typeof body.password === "string" ? body.password : "";
      const rows = await db.sql`SELECT password_hash FROM users WHERE id=${user.id} LIMIT 1` as any[];
      if (!password || !rows[0]?.password_hash || !verifyPassword(password, rows[0].password_hash)) return json({ error: "Senha incorreta." }, 401);
      return json({ ok:true });
    }
    if (action === "logout_other_sessions") {
      const token = parseCookies(req).portfolio_session || "";
      const currentHash = token ? hashSessionToken(token) : "";
      await db.sql`DELETE FROM sessions WHERE user_id=${user.id} AND token_hash<>${currentHash}`;
      await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${user.id},'SESSIONS_REVOKED','Outras sessões encerradas pelo usuário.',${ua(req)})`;
      return json(await loadDashboard(req,user));
    }
    return json({ error: "Ação de segurança inválida." }, 400);
  }

  return json({ error: "Método não permitido." }, 405);
};

export const config: Config = { path: "/api/security" };
