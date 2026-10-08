// Nytt projekt, gärna kopplat till en plats på Vreta.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCommand, useLabels } from "../app/AppContext";
import { Card, Chip, PageHeader } from "../ui/base";
import { PlacePicker, ProjectPicker, Select, TextArea, TextField, strOrNull } from "../ui/fields";
import { BusyButton } from "../ui/sheet";
import { newKey } from "../data/repo";

export default function NewProject() {
  const [sp] = useSearchParams();
  const run = useCommand();
  const nav = useNavigate();
  const { codes } = useLabels();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("build");
  const [status, setStatus] = useState("planned");
  const [place, setPlace] = useState(sp.get("plats") ?? "");
  const [parent, setParent] = useState("");
  const [desc, setDesc] = useState("");
  return (
    <div>
      <PageHeader kicker="Platser" title="Nytt projekt" />
      <Card className="mb-4">
        <TextField label="Namn" value={name} onChange={setName} autoFocus placeholder="Orangeriet, Dammen, Skogsträdgården fas 2 …" />
        <Select label="Slag" value={kind} onChange={setKind} options={codes("project_kind").map((c) => ({ value: c.code, label: c.label }))} />
        <div className="mb-3 flex flex-wrap gap-2">{[["idea", "Idé"], ["planned", "Planerat"], ["active", "Pågår"]].map(([v, l]) => <Chip key={v} on={status === v} onClick={() => setStatus(v)}>{l}</Chip>)}</div>
        <PlacePicker label="Var?" value={place} onChange={setPlace} storage={false} empty="Ingen särskild plats" />
        <ProjectPicker label="Del av ett större projekt?" value={parent} onChange={setParent} empty="Nej" />
        <TextArea label="Vad ska det bli?" value={desc} onChange={setDesc} rows={3} />
      </Card>
      <BusyButton className="btn-primary w-full" disabled={!name.trim()} onClick={async () => {
        const id = newKey();
        if (await run("CreateProject", { id, name: name.trim(), kind_code: kind, status, place_id: place || null, parent_id: parent || null, description: strOrNull(desc) }, { success: "Projektet är skapat" }))
          nav(`/projekt/${id}`, { replace: true });
      }}>Skapa</BusyButton>
    </div>
  );
}
