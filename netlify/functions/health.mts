import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { json } from "../lib/http.js";

export default async (_req: Request, _context: Context) => {
  try {
    const db = getDatabase();
    const rows = await db.sql`SELECT COUNT(*)::int AS count FROM users WHERE login_key IN ('camile lisboa', 'lucas souto')`;
    const count = Number((rows[0] as any)?.count ?? 0);
    return json({ ok: count === 2, database: true, usersReady: count === 2, version: "2.4.0" }, count === 2 ? 200 : 503);
  } catch {
    return json({ ok: false, database: false, usersReady: false, version: "2.4.0" }, 503);
  }
};

export const config: Config = { path: "/api/health" };
