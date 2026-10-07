// Rutter. Sidorna laddas när de behövs så att Idag och Fånga startar snabbt även på svagt nät.
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Starting, useApp } from "./app/AppContext";
import { Shell } from "./app/Shell";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { Spinner } from "./ui/base";

const Today = lazy(() => import("./pages/Today"));
const Capture = lazy(() => import("./pages/Capture"));
const Review = lazy(() => import("./pages/Review"));
const Proposal = lazy(() => import("./pages/Proposal"));
const CaptureDetail = lazy(() => import("./pages/CaptureDetail"));
const Things = lazy(() => import("./pages/Things"));
const NewObject = lazy(() => import("./pages/NewObject"));
const ObjectPage = lazy(() => import("./pages/ObjectPage"));
const AcquisitionPage = lazy(() => import("./pages/AcquisitionPage"));
const PickupPage = lazy(() => import("./pages/PickupPage"));
const Storage = lazy(() => import("./pages/Storage"));
const ListingPage = lazy(() => import("./pages/ListingPage"));
const NewListing = lazy(() => import("./pages/NewListing"));
const StoryStudio = lazy(() => import("./pages/StoryStudio"));
const ContentPage = lazy(() => import("./pages/ContentPage"));
const People = lazy(() => import("./pages/People"));
const NewPerson = lazy(() => import("./pages/NewPerson"));
const PersonPage = lazy(() => import("./pages/PersonPage"));
const OrganizationPage = lazy(() => import("./pages/OrganizationPage"));
const Places = lazy(() => import("./pages/Places"));
const NewPlace = lazy(() => import("./pages/NewPlace"));
const MapLayers = lazy(() => import("./pages/MapLayers"));
const PlacePage = lazy(() => import("./pages/PlacePage"));
const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const NewProject = lazy(() => import("./pages/NewProject"));
const Journal = lazy(() => import("./pages/Journal"));
const Tasks = lazy(() => import("./pages/Tasks"));
const EventPage = lazy(() => import("./pages/EventPage"));
const Ask = lazy(() => import("./pages/Ask"));
const SearchPage = lazy(() => import("./pages/Search"));
const Settings = lazy(() => import("./pages/Settings"));
const SyncIssues = lazy(() => import("./pages/SyncIssues"));
const Guest = lazy(() => import("./pages/Guest"));
const EntityPage = lazy(() => import("./pages/EntityPage"));
const Login = lazy(() => import("./pages/Login"));
const Bootstrap = lazy(() => import("./pages/Bootstrap"));

function Page({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return <ErrorBoundary inline key={loc.pathname}><Suspense fallback={<Spinner />}>{children}</Suspense></ErrorBoundary>;
}

export function App() {
  const { phase, progress, error, ctx, session } = useApp();
  const loc = useLocation();
  if (phase === "starting" || phase === "error") return <Starting progress={progress} error={error} />;
  if (phase === "login") return <Suspense fallback={<Starting progress="" />}><Login /></Suspense>;
  if (phase === "bootstrap") return <Suspense fallback={<Starting progress="" />}><Bootstrap /></Suspense>;

  // Gästlänken löses in även utan inloggning (en anonym session skapas)
  const isGuestRoute = loc.pathname.startsWith("/gast");
  const guest = ctx?.role === "guest" || (!!session?.is_anonymous && ctx?.role !== "host") || !session;
  if (guest || !ctx?.role) {
    return (
      <Shell>
        <Page>
          <Routes>
            <Route path="/gast/:token" element={<Guest />} />
            <Route path="/gast" element={<Guest />} />
            <Route path="*" element={isGuestRoute ? <Guest /> : <Navigate to="/gast" replace />} />
          </Routes>
        </Page>
      </Shell>
    );
  }

  return (
    <Shell>
      <Page>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/fanga" element={<Capture />} />
          <Route path="/granska" element={<Review />} />
          <Route path="/granska/fangst/:id" element={<CaptureDetail />} />
          <Route path="/granska/:id" element={<Proposal />} />
          <Route path="/saker" element={<Things />} />
          <Route path="/saker/ny" element={<NewObject />} />
          <Route path="/objekt/:id" element={<ObjectPage />} />
          <Route path="/inkop/:id" element={<AcquisitionPage />} />
          <Route path="/hamtning/:id" element={<PickupPage />} />
          <Route path="/lager" element={<Storage />} />
          <Route path="/lager/:id" element={<Storage />} />
          <Route path="/annons/ny" element={<NewListing />} />
          <Route path="/annons/:id" element={<ListingPage />} />
          <Route path="/beratta" element={<StoryStudio />} />
          <Route path="/berattelse/:id" element={<ContentPage />} />
          <Route path="/manniskor" element={<People />} />
          <Route path="/manniskor/ny" element={<NewPerson />} />
          <Route path="/person/:id" element={<PersonPage />} />
          <Route path="/organisation/:id" element={<OrganizationPage />} />
          <Route path="/platser" element={<Places />} />
          <Route path="/platser/ny" element={<NewPlace />} />
          <Route path="/platser/kartlager" element={<MapLayers />} />
          <Route path="/zon/:id" element={<PlacePage />} />
          <Route path="/byggnad/:id" element={<PlacePage />} />
          <Route path="/space/:id" element={<PlacePage />} />
          <Route path="/plats/:id" element={<PlacePage />} />
          <Route path="/ort/:id" element={<PlacePage />} />
          <Route path="/projekt/ny" element={<NewProject />} />
          <Route path="/projekt/:id" element={<ProjectPage />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/uppgifter" element={<Tasks />} />
          <Route path="/uppgift/:id" element={<Tasks />} />
          <Route path="/handelse/:id" element={<EventPage />} />
          <Route path="/fraga" element={<Ask />} />
          <Route path="/sok" element={<SearchPage />} />
          <Route path="/installningar" element={<Settings />} />
          <Route path="/synk" element={<SyncIssues />} />
          <Route path="/gast/:token" element={<Guest />} />
          <Route path="/gast" element={<Guest />} />
          <Route path="/:kind/:id" element={<EntityPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Page>
    </Shell>
  );
}
