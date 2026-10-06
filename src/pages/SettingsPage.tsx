import { Download, Loader2, LogOut, Volume2 } from "lucide-react";
import { useState } from "react";
import { useApp, useData } from "../app/AppContext";
import type { Role } from "../domain/types";
import { buildExport, type ExportProgress } from "../services/exportArchive";
import { canSpeak, setSpeechRate, speak, speechRate } from "../services/speech";
import { PageHeader, Section, formatDate } from "../ui/bits";
import { GuestLinks } from "../ui/GuestLinks";
import { leaveGuest } from "../services/guest";

const ROLE_LABEL: Record<Role, string> = { owner: "Ägare", contributor: "Medhjälpare", viewer: "Läsare" };
const EXPORT_KEY = "vreta.senaste.export";

function lastExport(): string | null {
  try {
    return localStorage.getItem(EXPORT_KEY);
  } catch {
    return null;
  }
}

const AUDIT_LABEL: Record<string, string> = {
  status_change: "Statusbyte", status_override: "Statusbyte (ägaren)", status_derived: "Partiets status", consent_change: "Samtycke ändrat",
  content_approved: "Inlägg godkänt", content_shared: "Inlägg delat", content_consent: "Samtycke för inlägg", channel_posted: "Annons ute",
  channel_removed: "Annons nedtagen", disposal: "Utflöde", create_from_proposal: "Förslag godkänt", visibility_change: "Synlighet ändrad",
  listing_created: "Annons skapad", listings_status: "Annonsstatus", leads_status: "Intressent", task_created: "Uppgift skapad",
  moved_in_storage: "Flyttad i lager", acquisition_status: "Anskaffning", pickup_status: "Hämtning",
  project_status: "Projektstatus", person_relation: "Relation", guest_link_created: "Gästlänk skapad", guest_link_revoked: "Gästlänk stängd",
};

export function SettingsPage() {
  const { repo, profile, refresh, toast } = useApp();
  const isOwner = profile?.role === "owner";
  const { data: audit } = useData((r) => r.audit());
  const { data: usage } = useData(async (r) => (isOwner && r.aiUsage ? r.aiUsage().catch(() => null) : null), [isOwner]);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [rate, setRate] = useState(speechRate());
  const [filter, setFilter] = useState("");
  const last = lastExport();
  const stale = !last || Date.now() - Date.parse(last) > 30 * 864e5;

  async function exportData() {
    try {
      const { blob, media, missing } = await buildExport(repo, setProgress);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `vreta-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      try {
        localStorage.setItem(EXPORT_KEY, new Date().toISOString());
      } catch {
        /* bara en påminnelse */
      }
      toast(`Exporten är klar – ${media} filer${missing ? `, ${missing} saknades` : ""}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  const shown = (audit ?? []).filter((a) => !filter || a.action === filter);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader kicker="Inställningar" title={profile?.name ?? ""} />

      {profile?.guest ? (
        <Section title="Du är gäst">
          <div className="card space-y-3 p-4">
            <p className="text-sm text-sot-2">Du tittar på Vreta via en gästlänk. Du kan se platserna, sakerna och projekten men inte ändra något. Privata uppgifter som priser och adresser visas inte, och människor syns bara om de sagt ja till det.</p>
            <button className="btn-secondary" onClick={async () => { await leaveGuest(repo); await refresh(); }}><LogOut size={18} aria-hidden="true" /> Lämna gästläget</button>
          </div>
        </Section>
      ) : (
      <Section title="Roll">
        <p className="mb-3">Du är inloggad som <strong>{profile ? ROLE_LABEL[profile.role] : ""}</strong>.</p>
        {repo.setDemoRole && (
          <div className="card p-4">
            <p className="mb-3 text-sm text-sot-3">Demoläge: byt roll för att se hur appen fungerar för medhjälpare och läsare.</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <button key={r} className={`chip ${profile?.role === r ? "chip-on" : ""}`} aria-pressed={profile?.role === r} onClick={async () => { await repo.setDemoRole!(r); await refresh(); }}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
          </div>
        )}
      </Section>
      )}

      {isOwner && <GuestLinks />}

      {canSpeak() && (
        <Section title="Tal">
          <div className="card flex flex-wrap items-center gap-4 p-4">
            <label htmlFor="rate" className="text-sm font-semibold">Uppläsningshastighet</label>
            <input id="rate" type="range" min={0.6} max={1.6} step={0.1} value={rate} className="flex-1 accent-[#8C2F1D]"
              onChange={(e) => { const v = Number(e.target.value); setRate(v); setSpeechRate(v); }} aria-valuetext={`${rate.toFixed(1)} gånger`} />
            <button className="btn-ghost text-sm" onClick={() => void speak("Sex gjutjärnsfönster ligger på hylla tre i garaget.")}><Volume2 size={16} aria-hidden="true" /> Provlyssna</button>
          </div>
          <p className="mt-2 text-[13px] text-sot-3">Mikrofonen är bara på när du själv trycker. Röstläget avslutas med ”stopp”.</p>
        </Section>
      )}

      {isOwner && (
        <Section title="Data och backup">
          <div className="card space-y-3 p-4">
            <p className="text-sm text-sot-2">Exporten är en ZIP med alla tabeller som JSON och CSV, originalbilder och kartunderlag. Den innehåller privata uppgifter – förvara den säkert.</p>
            <p className={`text-sm ${stale ? "font-semibold text-falu" : "text-sot-3"}`}>
              {last ? `Senaste export från den här enheten: ${formatDate(last)}.` : "Ingen export från den här enheten ännu."}
              {stale ? " Gör gärna en export minst en gång i månaden." : ""}
            </p>
            <button className="btn-secondary" disabled={!!progress} onClick={exportData}>
              {progress ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
              {progress ? `${progress.step} ${progress.total > 1 ? `${progress.done}/${progress.total}` : ""}` : "Exportera allt (ZIP)"}
            </button>
            {repo.kind === "supabase" && <p className="text-[13px] text-sot-3">Databasen säkerhetskopieras dessutom dagligen av Supabase; se <code>scripts/backup.sh</code> för en egen kopia och återställningstest.</p>}
          </div>
        </Section>
      )}

      {isOwner && usage && (
        <Section title="AI-förbrukning denna månad">
          {usage.length ? (
            <table className="card w-full text-sm">
              <thead><tr className="text-left text-sot-3"><th className="px-4 py-2 font-semibold">Funktion</th><th className="px-4 py-2 font-semibold">Anrop</th><th className="px-4 py-2 font-semibold">Tokens</th></tr></thead>
              <tbody>{usage.map((u) => <tr key={u.function} className="border-t border-dashed border-lera-light"><td className="px-4 py-2">{u.function}</td><td className="px-4 py-2">{u.calls}</td><td className="px-4 py-2">{(u.input_tokens + u.output_tokens).toLocaleString("sv-SE")}</td></tr>)}</tbody>
            </table>
          ) : <p className="text-sot-3">Inga AI-anrop ännu denna månad.</p>}
        </Section>
      )}

      <Section title="Tredjepartstjänster">
        <ul className="card divide-y divide-dashed divide-lera-light text-sm">
          <li className="px-4 py-3"><b>Google Maps</b> – får bara måladressen när du trycker Navigera. Vretakartan, objekt och personer skickas aldrig.</li>
          <li className="px-4 py-3"><b>Taligenkänning och uppläsning</b> – webbläsarens eller telefonens inbyggda tjänst. Ljudet skickas bara när du själv startat mikrofonen.</li>
          <li className="px-4 py-3"><b>Claude (Anthropic)</b> – får bara den rensade data som verktygen släpper igenom för din behörighet. Ingen träning på Vretas data.</li>
        </ul>
      </Section>

      {isOwner && (
        <Section title="Händelselogg" action={
          <select className="input w-auto py-1.5 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrera händelseloggen">
            <option value="">Allt</option>
            {[...new Set((audit ?? []).map((a) => a.action))].map((a) => <option key={a} value={a}>{AUDIT_LABEL[a] ?? a}</option>)}
          </select>
        }>
          {shown.length ? (
            <ul tabIndex={0} aria-label="Händelselogg" className="card max-h-96 divide-y divide-dashed divide-lera-light overflow-y-auto text-sm">
              {shown.slice(0, 200).map((a) => (
                <li key={a.id} className="flex justify-between gap-3 px-4 py-2">
                  <span>{AUDIT_LABEL[a.action] ?? a.action} <span className="text-sot-3">· {a.entity_type}</span></span>
                  <span className="whitespace-nowrap text-sot-3">{formatDate(a.at)} {new Date(a.at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sot-3">Inga händelser ännu.</p>}
        </Section>
      )}

      {repo.kind === "supabase" && !profile?.guest && (
        <button className="btn-ghost" onClick={async () => { await repo.signOut(); await refresh(); }}><LogOut size={18} aria-hidden="true" /> Logga ut</button>
      )}
    </div>
  );
}
