// Ny person. Samtycke frågas direkt – standard är "fråga först" (R1.1 8.6).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, useCan, useCommand } from "../app/AppContext";
import { CONSENT } from "../app/labels";
import { Card, Chip, PageHeader } from "../ui/base";
import { Select, TextArea, TextField, strOrNull } from "../ui/fields";
import { BusyButton } from "../ui/sheet";

export default function NewPerson() {
  const { ctx } = useApp();
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [locality, setLocality] = useState("");
  const [how, setHow] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [consent, setConsent] = useState({ name: "ask", image: "ask", contribution: "ask" });
  const [note, setNote] = useState("");
  return (
    <div>
      <PageHeader kicker="Människor" title="Ny person" />
      <Card className="mb-4">
        <TextField label="Namn" value={name} onChange={setName} autoFocus />
        <TextField label="Ort" value={locality} onChange={setLocality} hint="Hemorten nämns aldrig i det som delas." />
        <TextField label="Hur vi träffades" value={how} onChange={setHow} placeholder="Blocket, granne, via Lena …" />
        <div className="mb-1 text-sm font-semibold text-sot-2">Roller</div>
        <div className="mb-3 flex flex-wrap gap-2">
          {(ctx?.codes.person_role ?? []).filter((r) => !["guest", "host"].includes(r.code)).map((r) => (
            <Chip key={r.code} on={roles.includes(r.code)} onClick={() => setRoles((x) => x.includes(r.code) ? x.filter((y) => y !== r.code) : [...x, r.code])}>{r.label}</Chip>
          ))}
        </div>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-2 text-lg">Kontakt (privat)</h2>
        <TextField label="Telefon" type="tel" value={phone} onChange={setPhone} inputMode="tel" />
        <TextField label="Mejl" type="email" value={email} onChange={setEmail} inputMode="email" />
        <TextArea label="Anteckning" value={note} onChange={setNote} rows={2} />
      </Card>
      {can("ChangeConsent") && <Card className="mb-4">
        <h2 className="mb-2 text-lg">Får vi berätta om hen?</h2>
        {(["name", "image", "contribution"] as const).map((a) => (
          <Select key={a} label={{ name: "Nämna vid namn", image: "Visa bild", contribution: "Berätta vad hen bidragit med" }[a]} value={consent[a]}
            onChange={(v) => setConsent((c) => ({ ...c, [a]: v }))} options={Object.entries(CONSENT).map(([value, label]) => ({ value, label }))} />
        ))}
      </Card>}
      <BusyButton className="btn-primary w-full" disabled={!name.trim()} onClick={async () => {
        const r = await run<{ person_id: string }>("CreatePerson", { display_name: name.trim(), locality: strOrNull(locality), how_we_met: strOrNull(how), roles,
          phone: strOrNull(phone), email: strOrNull(email), notes: strOrNull(note) });
        if (!r?.person_id) return;
        if (can("ChangeConsent") && (consent.name !== "ask" || consent.image !== "ask" || consent.contribution !== "ask")) {
          await run("ChangeConsent", { person_id: r.person_id, ...consent, given_how: "när personen lades in" });
        }
        nav(`/person/${r.person_id}`, { replace: true });
      }}>Spara</BusyButton>
    </div>
  );
}
