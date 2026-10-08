// Vädertjänsten (R2.1, flaggan weather): hämtar prognos och senaste dygnets uppmätta väder från Open-Meteo
// för varje plats som slagit på väder, och sparar via api.ingest_weather. Anropas av pg_cron (pg_net)
// eller GitHub Actions med tjänstenyckeln – aldrig av appen.
import { handle, HttpError, json, serviceClient } from "../_server/http.ts";

type Site = { site_id: string; lat: number; lon: number; timezone: string };
const HOURLY = ["temperature_2m", "precipitation", "wind_speed_10m", "wind_gusts_10m", "relative_humidity_2m", "weather_code"];

function rows(h: Record<string, any[]>, from: number, to: number) {
  const out: { start: string; end: string; data: Record<string, number | null> }[] = [];
  for (let i = from; i < to && i < h.time.length; i++) {
    const start = new Date(`${h.time[i]}Z`);
    out.push({ start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString(), data: {
      temp_c: h.temperature_2m[i], precip_mm: h.precipitation[i], wind_ms: h.wind_speed_10m[i], gust_ms: h.wind_gusts_10m[i],
      humidity: h.relative_humidity_2m[i], code: h.weather_code[i] } });
  }
  return out;
}

Deno.serve(handle(async (req) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || req.headers.get("Authorization") !== `Bearer ${key}`) throw new HttpError(401, "unauthorized");
  const sb = serviceClient();
  const { data: sites, error } = await sb.rpc("weather_sites");
  if (error) throw new HttpError(500, "sites", error.message);
  const issued = new Date().toISOString();
  const result: Record<string, unknown> = {};
  for (const s of (sites ?? []) as Site[]) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=${HOURLY.join(",")}&wind_speed_unit=ms&timezone=UTC&past_days=1&forecast_days=3`;
    const r = await fetch(url);
    if (!r.ok) { result[s.site_id] = { error: r.status }; continue; }
    const h = (await r.json()).hourly as Record<string, any[]>;
    const nowIdx = h.time.findIndex((t: string) => new Date(`${t}Z`).getTime() > Date.now()) ;
    const observed = rows(h, 0, Math.max(0, nowIdx)).map((x) => ({ period_start: x.start, period_end: x.end, data: x.data }));
    const forecast = rows(h, Math.max(0, nowIdx - 1), h.time.length).map((x) => ({ valid_from: x.start, valid_to: x.end, data: x.data }));
    const { data, error: e } = await sb.rpc("ingest_weather", { p_site: s.site_id, p_payload: { source: "open_meteo", issued_at: issued, forecast, observed } });
    result[s.site_id] = e ? { error: e.message } : data;
  }
  return json({ issued_at: issued, sites: result });
}));
