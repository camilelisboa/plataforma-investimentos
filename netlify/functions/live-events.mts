import type { Config, Context } from "@netlify/functions";
import { getSessionUser } from "../lib/auth.js";
import { json } from "../lib/http.js";

async function getJson(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9_000) });
    if (!r.ok) return { ok: false as const, status: r.status, data: null as any };
    return { ok: true as const, status: r.status, data: await r.json() as any };
  } catch { return { ok: false as const, status: 0, data: null as any }; }
}
function day(d: Date) { return d.toISOString().slice(0, 10); }
function normalizeImpact(value: unknown) {
  const v = String(value || "").toLowerCase();
  if (v.includes("high") || v === "3") return "high";
  if (v.includes("medium") || v === "2") return "medium";
  if (v.includes("low") || v === "1") return "low";
  return "unknown";
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  const user = await getSessionUser(req);
  if (!user) return json({ error: "Sessão expirada." }, 401);

  const now = new Date(); const end = new Date(now); end.setDate(end.getDate() + 7);
  const url = new URL(req.url); const from = url.searchParams.get("from") || day(now); const to = url.searchParams.get("to") || day(end);
  const key = Netlify.env.get("FINNHUB_API_KEY") || "";
  if (!key) return json({ requestedAt: new Date().toISOString(), from, to, economic: [], earnings: [], source: "Finnhub", providerConfigured: false, providerNote: "Configure FINNHUB_API_KEY no ambiente Netlify para habilitar o calendário econômico e resultados corporativos reais." });

  const [economicRes, earningsRes] = await Promise.all([
    getJson(`https://finnhub.io/api/v1/calendar/economic?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(key)}`),
    getJson(`https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(key)}`),
  ]);

  const economicRaw = Array.isArray(economicRes.data?.economicCalendar) ? economicRes.data.economicCalendar : [];
  const economic = economicRaw.slice(0, 80).map((x: any) => ({
    date: String(x?.time || x?.date || ""), country: String(x?.country || ""), event: String(x?.event || "Evento econômico"), impact: normalizeImpact(x?.impact), actual: x?.actual ?? null, estimate: x?.estimate ?? x?.consensus ?? null, prev: x?.prev ?? x?.previous ?? null,
  })).filter((x: any) => x.date && x.event);

  const earningsRaw = Array.isArray(earningsRes.data?.earningsCalendar) ? earningsRes.data.earningsCalendar : [];
  const earnings = earningsRaw.slice(0, 80).map((x: any) => ({
    date: String(x?.date || ""), symbol: String(x?.symbol || "").toUpperCase(), hour: String(x?.hour || ""), epsEstimate: x?.epsEstimate ?? null, revenueEstimate: x?.revenueEstimate ?? null, quarter: x?.quarter ?? null, year: x?.year ?? null,
  })).filter((x: any) => x.date && x.symbol);

  return json({ requestedAt: new Date().toISOString(), from, to, economic, earnings, source: "Finnhub", providerConfigured: true, providerNote: economicRes.ok ? "Calendário econômico consultado no provedor conectado." : "O provedor respondeu sem calendário econômico disponível neste momento.", failures: [!economicRes.ok ? { name: "economic", status: economicRes.status } : null, !earningsRes.ok ? { name: "earnings", status: earningsRes.status } : null].filter(Boolean) });
};

export const config: Config = { path: "/api/live-events" };
