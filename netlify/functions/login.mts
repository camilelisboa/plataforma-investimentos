import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { hashSessionToken, newSessionToken, normalizeLogin, sessionCookie, verifyPassword } from "../lib/auth.js";
import { json } from "../lib/http.js";

function ua(req:Request){return (req.headers.get('user-agent')||'').slice(0,300)}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  let body: { username?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Dados de acesso inválidos." }, 400); }
  const username = typeof body.username === "string" ? normalizeLogin(body.username) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || password.length > 128) return json({ error: "Informe usuário e senha." }, 400);

  const db = getDatabase();
  await db.sql`DELETE FROM sessions WHERE expires_at <= NOW()`;
  const users = await db.sql`
    SELECT id, login_key, display_name, password_hash, theme, must_change_password, failed_login_count, locked_until
    FROM users WHERE login_key = ${username} LIMIT 1
  ` as any[];
  const user = users[0] as any;

  if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return json({ error: "Acesso temporariamente bloqueado após tentativas incorretas. Tente novamente em alguns minutos." }, 429);
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    if(user){
      const next=Math.min(99,Number(user.failed_login_count||0)+1);const lock=next>=5;
      await db.sql`UPDATE users SET failed_login_count=${lock?0:next}, locked_until=${lock?new Date(Date.now()+10*60*1000).toISOString():null} WHERE id=${user.id}`;
      await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${user.id},'LOGIN_FAILED',${lock?'Conta bloqueada por 10 minutos após 5 tentativas incorretas.':`Senha incorreta (${next}/5).`},${ua(req)})`;
    }
    return json({ error: "Usuário ou senha inválidos." }, 401);
  }

  await db.sql`UPDATE users SET failed_login_count=0,locked_until=NULL,last_login_at=NOW() WHERE id=${user.id}`;
  const token = newSessionToken(); const tokenHash = hashSessionToken(token);
  await db.sql`INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, last_seen_at) VALUES (${user.id}, ${tokenHash}, NOW() + INTERVAL '7 days', ${ua(req)}, NOW())`;
  await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${user.id},'LOGIN_SUCCESS','Sessão iniciada.',${ua(req)})`;

  return json({ user: { displayName: user.display_name, theme: user.theme, mustChangePassword: user.must_change_password } },200,{ "set-cookie": sessionCookie(token, req) });
};
export const config: Config = { path: "/api/login" };
