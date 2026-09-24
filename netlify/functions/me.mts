import type { Config, Context } from "@netlify/functions";
import { getSessionUser } from "../lib/auth.js";
import { json } from "../lib/http.js";

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ authenticated: false }, 401);

  return json({
    authenticated: true,
    user: {
      displayName: user.display_name,
      theme: user.theme,
      mustChangePassword: user.must_change_password,
    },
  });
};

export const config: Config = { path: "/api/me" };
