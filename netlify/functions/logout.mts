import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { clearSessionCookie, hashSessionToken } from "../lib/auth.js";
import { parseCookies, json } from "../lib/http.js";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const token = parseCookies(req).portfolio_session; const db = getDatabase();
  if (token) {
    const tokenHash=hashSessionToken(token);
    const rows=await db.sql`SELECT user_id FROM sessions WHERE token_hash=${tokenHash} LIMIT 1` as any[];
    const uid=Number(rows[0]?.user_id||0);
    if(uid) await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${uid},'LOGOUT','Sessão encerrada.',${(req.headers.get('user-agent')||'').slice(0,300)})`;
    await db.sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
  }
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(req) });
};
export const config: Config = { path: "/api/logout" };
