// Gästvyn (familj och vänner) och inlösen av länkar. Gästen ser bara projektionen pub.guest_item: det som är
// delbart, utan adresser, priser eller namn på personer som inte sagt ja (INV-08).
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useApp, useQuery } from "../app/AppContext";
import { d } from "../app/format";
import { reasonCode, reasonText } from "../data/pglite/engine";
import { Card, Empty, ErrorNote, Section, Spinner, Stamp } from "../ui/base";
import { useMediaUrl } from "../ui/media";

const SECTIONS: { kind: string; title: string }[] = [
  { kind: "event", title: "Senaste nytt" }, { kind: "new_life", title: "Nytt liv" }, { kind: "project", title: "Projekten" },
  { kind: "listing", title: "Vi har att ge bort eller sälja" }, { kind: "place", title: "Platserna" }, { kind: "person", title: "Människorna" },
];

export default function Guest() {
  const { token } = useParams();
  const { ctx, session } = useApp();
  if (token) return <Redeem token={token} />;
  if (!session || !ctx?.site) return <NoAccess />;
  return <GuestHome />;
}

function Redeem({ token }: { token: string }) {
  const { repo, session, refreshContext } = useApp();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [needsAccount, setNeedsAccount] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!session && repo.signInAnonymously) await repo.signInAnonymously();
        const r = await repo.api<{ role: string }>("redeem_guest_link", { token });
        await refreshContext();
        if (alive) nav(r.role === "guest" ? "/gast" : "/", { replace: true });
      } catch (e) {
        const m = (e as Error).message;
        if (reasonCode(m) === "needs_account") setNeedsAccount(true);
        else if (alive) setErr(reasonText(m));
      }
    })();
    return () => { alive = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (needsAccount) {
    return (
      <Card className="mt-8">
        <h1 className="mb-2 text-2xl">Välkommen!</h1>
        <p className="mb-3">Länken ger dig en egen roll på platsen. Logga in med din e-post så kopplas den till dig.</p>
        <button type="button" className="btn-primary" onClick={async () => { sessionStorage.setItem("vreta2-pending-link", token); await repo.signOut(); location.hash = "#/"; location.reload(); }}>Logga in</button>
      </Card>
    );
  }
  if (err) return <div className="mt-8"><ErrorNote>{err}</ErrorNote></div>;
  return <Spinner label="Öppnar länken …" />;
}

function NoAccess() {
  return (
    <Card className="mt-8 text-center">
      <h1 className="mb-2 text-2xl">VRETA</h1>
      <p>Du behöver en länk från platsen för att se den här vyn.</p>
    </Card>
  );
}

function GuestHome() {
  const { data, error, loading } = useQuery<{ site: any; items: any[] }>("q_guest_home");
  const { ctx } = useApp();
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <NoAccess />;
  if (ctx?.role && ctx.role !== "guest" && ctx.role !== "host") return <Navigate to="/" replace />;
  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-4xl text-falu">{data.site?.name}</h1>
        {data.site?.description && <p className="mt-1 text-lg text-sot-2">{data.site.description}</p>}
      </header>
      {data.items.length === 0 && <Empty>Inget delat än.</Empty>}
      {SECTIONS.map((s) => {
        const items = data.items.filter((i) => i.kind === s.kind);
        if (!items.length) return null;
        return (
          <Section key={s.kind} title={s.title}>
            <div className={s.kind === "event" ? "card divide-y divide-dashed divide-lera" : "grid gap-3 sm:grid-cols-2"}>
              {items.map((i) => s.kind === "event"
                ? <div key={i.id} className="flex justify-between gap-3 px-4 py-2.5"><span>{i.title}</span><span className="shrink-0 text-sm text-sot-3">{d(i.occurred_at)}</span></div>
                : <GuestCard key={i.id} i={i} />)}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

function GuestCard({ i }: { i: any }) {
  const url = useMediaUrl(i.image_path);
  return (
    <Card className="overflow-hidden !p-0">
      {url && <img src={url} alt="" className="h-40 w-full object-cover" loading="lazy" />}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2"><h3 className="text-lg">{i.title}</h3>{i.status_label && i.kind !== "place" && <Stamp>{i.status_label}</Stamp>}</div>
        {i.place_label && <div className="text-sm text-sot-3">{i.place_label}</div>}
        {i.summary && <p className="mt-1 text-sot-2">{i.summary}</p>}
        {i.kind === "person" && i.payload?.roles?.length > 0 && <div className="mt-1 text-sm text-sot-3">{i.payload.roles.join(", ")}</div>}
        {i.kind === "project" && (i.payload?.needs ?? []).length > 0 && (
          <ul className="mt-2 text-sm">{i.payload.needs.map((n: any, k: number) => <li key={k}>{n.title}: <span className="text-sot-3">{n.progress}</span></li>)}</ul>
        )}
      </div>
    </Card>
  );
}
