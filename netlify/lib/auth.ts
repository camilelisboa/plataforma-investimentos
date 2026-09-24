import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { parseCookies } from "./http.js";

export type SessionUser = {
  id: number;
  login_key: string;
  display_name: string;
  theme: "camile" | "lucas";
  must_change_password: boolean;
};

export function normalizeLogin(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function makePasswordHash(password: string) {
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const derived = scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [kind, nRaw, rRaw, pRaw, saltB64, hashB64] = encoded.split("$");
  if (kind !== "scrypt" || !nRaw || !rRaw || !pRaw || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  });

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookie(token: string, req: Request) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `portfolio_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`;
}

export function clearSessionCookie(req: Request) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `portfolio_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = parseCookies(req).portfolio_session;
  if (!token) return null;

  const db = getDatabase();
  const tokenHash = hashSessionToken(token);
  const rows = await db.sql`
    SELECT u.id, u.login_key, u.display_name, u.theme, u.must_change_password,
           s.id AS session_id, s.last_seen_at,
           COALESCE(sec.idle_enabled, TRUE) AS idle_enabled,
           COALESCE(sec.idle_timeout_minutes, 30) AS idle_timeout_minutes
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_security_settings sec ON sec.user_id = u.id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > NOW()
    LIMIT 1
  `;
  const user=(rows[0] as any | undefined) ?? null;
  if(!user) return null;

  const lastSeen = user.last_seen_at ? new Date(user.last_seen_at).getTime() : Date.now();
  const idleMs = Math.max(5, Number(user.idle_timeout_minutes || 30)) * 60 * 1000;
  if(user.idle_enabled !== false && Date.now() - lastSeen > idleMs){
    await db.sql`DELETE FROM sessions WHERE id=${Number(user.session_id)}`;
    await db.sql`INSERT INTO security_audit(user_id,event_type,detail,user_agent) VALUES(${Number(user.id)},'SESSION_EXPIRED','Sessão encerrada por inatividade no servidor.',${(req.headers.get('user-agent')||'').slice(0,300)})`;
    return null;
  }
  if(!user.last_seen_at || Date.now()-lastSeen>5*60*1000){
    await db.sql`UPDATE sessions SET last_seen_at=NOW() WHERE id=${Number(user.session_id)}`;
  }
  return user as SessionUser;
}
