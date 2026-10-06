import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../app/AppContext";
import { LogoMark } from "../ui/Logo";

/** /gast/<nyckel>: kliver in som gäst utan konto och går till startsidan. */
export function GuestEntryPage() {
  const { token } = useParams();
  const { repo, refresh } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await repo.enterAsGuest(token ?? "");
        await refresh();
        navigate("/", { replace: true });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [repo, refresh, navigate, token]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark className="h-14 w-14" />
      {error ? (
        <>
          <h1 className="text-2xl">Länken fungerar inte</h1>
          <p className="max-w-sm text-sot-3">{error}. Be den som skickade länken om en ny.</p>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sot-3"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Välkommen till Vreta …</p>
      )}
    </div>
  );
}

