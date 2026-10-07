// Första start: skapa platsen (du blir ägare) – eller öppna en inbjudan du fått.
import { useState } from "react";
import { MapPin } from "lucide-react";
import { useApp } from "../app/AppContext";
import { reasonText } from "../data/pglite/engine";
import { here } from "../services/geo";
import { ErrorNote } from "../ui/base";
import { TextArea, TextField, strOrNull } from "../ui/fields";
import { BusyButton } from "../ui/sheet";

export default function Bootstrap() {
  const { repo, refreshContext } = useApp();
  const pending = sessionStorage.getItem("vreta2-pending-link");
  const [name, setName] = useState("");
  const [you, setYou] = useState("");
  const [desc, setDesc] = useState("");
  const [address, setAddress] = useState("");
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex min-h-screen items-center justify-center bg-kalk p-4">
      <div className="card card-pad w-full max-w-md">
        <div className="mb-1 font-serif text-4xl text-falu">Välkommen</div>
        {pending ? (
          <>
            <p className="mb-4 text-sot-2">Du har en inbjudan till en plats.</p>
            {err && <div className="mb-3"><ErrorNote>{err}</ErrorNote></div>}
            <BusyButton className="btn-primary w-full" onClick={async () => {
              try { await repo.api("redeem_guest_link", { token: pending }); sessionStorage.removeItem("vreta2-pending-link"); await refreshContext(); }
              catch (e) { setErr(reasonText((e as Error).message)); }
            }}>Öppna inbjudan</BusyButton>
          </>
        ) : (
          <>
            <p className="mb-4 text-sot-2">Berätta om platsen. Du blir ägare och kan bjuda in andra sedan.</p>
            <TextField label="Platsens namn" value={name} onChange={setName} placeholder="Vreta" autoFocus />
            <TextField label="Ditt namn" value={you} onChange={setYou} />
            <TextArea label="Kort om platsen" value={desc} onChange={setDesc} rows={2} placeholder="En regenerativ återbruksfastighet …" />
            <TextField label="Adress (privat)" value={address} onChange={setAddress} hint="Visas aldrig utåt. Bara orten används i annonser." />
            <button type="button" className="btn-ghost btn-small mb-3" onClick={async () => { try { const h = await here(); setPos({ lat: h.lat, lon: h.lon }); } catch (e) { setErr((e as Error).message); } }}>
              <MapPin size={15} /> {pos ? "Ungefärligt läge sparat" : "Använd min position som platsens läge"}</button>
            {err && <div className="mb-3"><ErrorNote>{err}</ErrorNote></div>}
            <BusyButton className="btn-primary w-full" disabled={!name.trim()} onClick={async () => {
              setErr(null);
              try {
                await repo.api("bootstrap_site", { name: name.trim(), display_name: strOrNull(you), description: strOrNull(desc), address: strOrNull(address),
                  approx_lat: pos ? Math.round(pos.lat * 100) / 100 : null, approx_lon: pos ? Math.round(pos.lon * 100) / 100 : null });
                await refreshContext();
              } catch (e) { setErr(reasonText((e as Error).message)); }
            }}>Skapa platsen</BusyButton>
          </>
        )}
      </div>
    </div>
  );
}
