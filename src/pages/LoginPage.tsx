import { useState } from "react";
import { useApp } from "../app/AppContext";
import { Logo } from "../ui/Logo";

export function LoginPage() {
  const { repo, profile, refresh } = useApp();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [siteName, setSiteName] = useState("Vreta");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        {!profile ? (
          sent ? (
            <p className="text-center">Kolla din e-post – vi har skickat en inloggningslänk till <strong>{email}</strong>.</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await repo.signInWithEmail(email);
                  setSent(true);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <h1 className="text-2xl">Logga in</h1>
              <div>
                <label className="field-label" htmlFor="email">E-post</label>
                <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <button className="btn-primary w-full">Skicka inloggningslänk</button>
            </form>
          )
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await repo.bootstrapSite(siteName, name);
                await refresh();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <h1 className="text-2xl">Skapa din plats</h1>
            <p className="text-sm text-sot-3">Du blir ägare och kan bjuda in medhjälpare senare.</p>
            <div>
              <label className="field-label" htmlFor="site">Platsens namn</label>
              <input id="site" className="input" required value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="name">Ditt namn</label>
              <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn-primary w-full">Skapa</button>
          </form>
        )}
        {error && <p className="mt-4 text-sm text-falu">{error}</p>}
      </div>
    </div>
  );
}
