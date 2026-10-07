// Inloggning (Supabase): länk via e-post, eller lösenord. Demoläget har ingen inloggning.
import { useState } from "react";
import { useApp } from "../app/AppContext";
import { ErrorNote } from "../ui/base";
import { TextField } from "../ui/fields";
import { BusyButton } from "../ui/sheet";

export default function Login() {
  const { repo, refreshContext } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = sessionStorage.getItem("vreta2-pending-link");
  return (
    <div className="flex min-h-screen items-center justify-center bg-kalk p-4">
      <div className="card card-pad w-full max-w-sm">
        <div className="mb-1 font-serif text-4xl text-falu">VRETA</div>
        <p className="mb-5 text-sot-2">Platsens digitala minne, nervsystem och berättarröst.</p>
        {pending && <p className="mb-3 rounded-lg bg-linolja-pale/50 px-3 py-2 text-linolja">Logga in så öppnas inbjudan direkt.</p>}
        {sent ? (
          <p>Kolla din e-post – vi har skickat en länk till <strong>{email}</strong>. Öppna den på den här enheten.</p>
        ) : (
          <form onSubmit={(e) => e.preventDefault()}>
            <TextField label="E-post" type="email" value={email} onChange={setEmail} inputMode="email" autoFocus />
            {usePassword && <TextField label="Lösenord" type="password" value={password} onChange={setPassword} />}
            {err && <div className="mb-3"><ErrorNote>{err}</ErrorNote></div>}
            <BusyButton type="submit" className="btn-primary w-full" disabled={!email.includes("@")} onClick={async () => {
              setErr(null);
              try {
                if (usePassword) { await repo.signInWithPassword!(email.trim(), password); await refreshContext(); }
                else { await repo.signInWithEmail!(email.trim()); setSent(true); }
              } catch (e) { setErr((e as Error).message); }
            }}>{usePassword ? "Logga in" : "Skicka inloggningslänk"}</BusyButton>
            <button type="button" className="btn-ghost mt-2 w-full" onClick={() => setUsePassword(!usePassword)}>{usePassword ? "Logga in med länk i stället" : "Jag har ett lösenord"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
