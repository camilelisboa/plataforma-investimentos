import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser } from "../lib/auth.js";
import { json } from "../lib/http.js";

const PALETTES = {
  camile: ["camile-baby-sage", "camile-rose-noir", "camile-sage-blush", "camile-powder-pastel", "camile-champagne-bordeaux", "camile-cobalt-porcelain", "camile-espresso-butter", "camile-lavender-smoke", "camile-terracotta-olive", "camile-cherry-cream", "camile-ocean-pearl", "camile-mocha-ballet"],
  lucas: ["lucas-black-tie", "lucas-graphite", "lucas-ivory-ink", "lucas-midnight-silver", "lucas-british-racing", "lucas-oxford-navy", "lucas-bordeaux-club", "lucas-camel-house", "lucas-monaco-night", "lucas-forest-stone", "lucas-cigar-linen", "lucas-deep-plum"],
} as const;

function defaultPalette(theme: "camile" | "lucas") {
  return theme === "lucas" ? "lucas-black-tie" : "camile-baby-sage";
}

function validPhoto(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Foto de perfil inválida.");
  if (value.length > 650_000) throw new Error("A foto de perfil ficou muito grande. Escolha outra imagem.");
  if (!/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)) throw new Error("Formato de foto não permitido.");
  return value;
}

export default async (req: Request, _context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão inválida." }, 401);
  const db = getDatabase();

  if (req.method === "GET") {
    const rows = await db.sql`
      SELECT palette_key, profile_photo_data_url, pinned_sections, updated_at
      FROM user_preferences WHERE user_id = ${user.id} LIMIT 1
    ` as any[];
    const row = rows[0];
    return json({ preferences: {
      paletteKey: row?.palette_key || defaultPalette(user.theme),
      profilePhotoDataUrl: row?.profile_photo_data_url || null,
      pinnedSections: Array.isArray(row?.pinned_sections) ? row.pinned_sections : ['portfolio','decision','rebalance','reports','governance','closing'],
      updatedAt: row?.updated_at || null,
    }});
  }

  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
    const allowed = PALETTES[user.theme] as readonly string[];
    const paletteKey = typeof body?.paletteKey === "string" && allowed.includes(body.paletteKey) ? body.paletteKey : defaultPalette(user.theme);
    let profilePhotoDataUrl: string | null;
    try { profilePhotoDataUrl = validPhoto(body?.profilePhotoDataUrl); } catch (e: any) { return json({ error: e.message }, 400); }
    const allowedSections = new Set(['portfolio','transactions','income','performance','wealth','fiscal','automation','security','analysis','decision','rebalance','market','live','watchlist','finance','planning','reports','rules','governance','closing','agenda','history']);
    const rawPinned = Array.isArray(body?.pinnedSections) ? body.pinnedSections : ['portfolio','decision','rebalance','reports','governance','closing'];
    const pinnedSections = [...new Set(rawPinned.filter((x: unknown) => typeof x === 'string' && allowedSections.has(x as string)))].slice(0,6);

    const rows = await db.sql`
      INSERT INTO user_preferences (user_id, palette_key, profile_photo_data_url, pinned_sections, updated_at)
      VALUES (${user.id}, ${paletteKey}, ${profilePhotoDataUrl}, ${JSON.stringify(pinnedSections)}::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        palette_key = EXCLUDED.palette_key,
        profile_photo_data_url = EXCLUDED.profile_photo_data_url,
        pinned_sections = EXCLUDED.pinned_sections,
        updated_at = NOW()
      RETURNING palette_key, profile_photo_data_url, pinned_sections, updated_at
    ` as any[];
    const row = rows[0];
    return json({ preferences: { paletteKey: row.palette_key, profilePhotoDataUrl: row.profile_photo_data_url, pinnedSections: row.pinned_sections || pinnedSections, updatedAt: row.updated_at }});
  }

  return json({ error: "Método não permitido." }, 405);
};

export const config: Config = { path: "/api/preferences" };
