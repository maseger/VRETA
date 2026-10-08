// Inloggning (Supabase): länk via e-post, eller lösenord. Demoläget har ingen inloggning.
import { useState } from "react";
import { useApp } from "../app/AppContext";
import { ErrorNote } from "../ui/base";
import { TextField } from "../ui/fields";
import { BusyButton } from "../ui/sheet";
import { TitleLockup } from "../ui/brand";
import tradgard from "../assets/brand/vreta-tradgard.webp";
import angsremsa from "../assets/brand/angsremsa.webp";

export default function Login() {
  const { repo, refreshContext } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = sessionStorage.getItem("vreta2-pending-link");
  return (
    <div className="flex min-h-screen flex-col bg-kalk">
      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-8 md:grid-cols-2 md:items-center md:gap-12 md:py-16">
        <div>
          <TitleLockup className="mb-3" />
          <p className="mb-1 text-[18px] font-bold text-forest">Platsen, materialen och livet</p>
          <p className="mb-6 text-[17px] leading-[1.6] text-sot">Platsens digitala minne, nervsystem och berättarröst.</p>
          <div className="card card-pad w-full max-w-sm">
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
          <p className="signoff mt-6">Mer liv tillsammans.</p>
        </div>
        <img src={tradgard} alt="Orangeriet med grönt tak och trädgården på Vreta" className="aspect-[4/3] w-full rounded-2xl object-cover shadow-papper md:aspect-[4/5]" />
      </div>
      {/* Ängsblommor som stiger från sidans nederkant (profilens illustration, aldrig inramad) */}
      <div aria-hidden="true" className="relative h-28 w-full md:h-40" style={{ backgroundImage: `url(${angsremsa})`, backgroundRepeat: "repeat-x", backgroundSize: "auto 100%", backgroundPosition: "center bottom" }}>
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-kalk to-transparent" />
      </div>
    </div>
  );
}
