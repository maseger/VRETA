import { Download, LogOut } from "lucide-react";
import { useApp, useData } from "../app/AppContext";
import type { Role } from "../domain/types";
import { PageHeader, Section, formatDate } from "../ui/bits";

const ROLE_LABEL: Record<Role, string> = { owner: "Ägare", contributor: "Medhjälpare", viewer: "Läsare" };

export function SettingsPage() {
  const { repo, profile, refresh } = useApp();
  const { data: audit } = useData((r) => r.audit());

  async function exportData() {
    const data = await repo.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vreta-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader kicker="Inställningar" title={profile?.name ?? ""} />

      <Section title="Roll">
        <p className="mb-3">Du är inloggad som <strong>{profile ? ROLE_LABEL[profile.role] : ""}</strong>.</p>
        {repo.setDemoRole && (
          <div className="card p-4">
            <p className="mb-3 text-sm text-sot-3">Demoläge: byt roll för att se hur appen fungerar för medhjälpare och läsare.</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <button key={r} className={`chip ${profile?.role === r ? "chip-on" : ""}`} onClick={async () => { await repo.setDemoRole!(r); await refresh(); }}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
          </div>
        )}
      </Section>

      {profile?.role === "owner" && (
        <Section title="Data">
          <button className="btn-secondary" onClick={exportData}><Download size={18} aria-hidden="true" /> Exportera allt som JSON</button>
        </Section>
      )}

      {profile?.role === "owner" && (
        <Section title="Händelselogg">
          {audit?.length ? (
            <ul className="card max-h-80 divide-y divide-dashed divide-lera-light overflow-y-auto text-sm">
              {audit.slice(0, 50).map((a) => (
                <li key={a.id} className="flex justify-between gap-3 px-4 py-2">
                  <span className="font-mono text-[12px]">{a.action}</span>
                  <span className="text-sot-3">{formatDate(a.at)} {new Date(a.at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sot-3">Inga händelser ännu.</p>}
        </Section>
      )}

      {repo.kind === "supabase" && (
        <button className="btn-ghost" onClick={async () => { await repo.signOut(); await refresh(); }}><LogOut size={18} aria-hidden="true" /> Logga ut</button>
      )}
    </div>
  );
}
