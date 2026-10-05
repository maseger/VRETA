import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useApp } from "./app/AppContext";
import { AppShell } from "./ui/AppShell";
import { LogoMark } from "./ui/Logo";
import { LoginPage } from "./pages/LoginPage";
import { TodayPage } from "./pages/TodayPage";
// Sidorna laddas först när de öppnas, så att Idag startar snabbt (NFR-004). Kartsidorna drar in MapLibre.
const AskPage = lazy(() => import("./pages/AskPage").then((m) => ({ default: m.AskPage })));
const CapturePage = lazy(() => import("./pages/CapturePage").then((m) => ({ default: m.CapturePage })));
const JournalPage = lazy(() => import("./pages/JournalPage").then((m) => ({ default: m.JournalPage })));
const LabelsPage = lazy(() => import("./pages/LabelsPage").then((m) => ({ default: m.LabelsPage })));
const ZonePage = lazy(() => import("./pages/ZonePage").then((m) => ({ default: m.ZonePage })));
const NewPickupPage = lazy(() => import("./pages/NewPickupPage").then((m) => ({ default: m.NewPickupPage })));
const PersonPage = lazy(() => import("./pages/PersonPage").then((m) => ({ default: m.PersonPage })));
const PickupPage = lazy(() => import("./pages/PickupPage").then((m) => ({ default: m.PickupPage })));
const StorageLocationPage = lazy(() => import("./pages/StorageLocationPage").then((m) => ({ default: m.StorageLocationPage })));
const StoragePage = lazy(() => import("./pages/StoragePage").then((m) => ({ default: m.StoragePage })));
const ObjectPage = lazy(() => import("./pages/ObjectPage").then((m) => ({ default: m.ObjectPage })));
const ProposalPage = lazy(() => import("./pages/ProposalPage").then((m) => ({ default: m.ProposalPage })));
const ReviewListPage = lazy(() => import("./pages/ReviewListPage").then((m) => ({ default: m.ReviewListPage })));
const SakerPage = lazy(() => import("./pages/SakerPage").then((m) => ({ default: m.SakerPage })));
const ManniskorPage = lazy(() => import("./pages/ManniskorPage").then((m) => ({ default: m.ManniskorPage })));
const PlatserPage = lazy(() => import("./pages/PlatserPage").then((m) => ({ default: m.PlatserPage })));
const ProjectPage = lazy(() => import("./pages/ProjectPage").then((m) => ({ default: m.ProjectPage })));
const ExternalPlacePage = lazy(() => import("./pages/ExternalPlacePage").then((m) => ({ default: m.ExternalPlacePage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const StoryStudioPage = lazy(() => import("./pages/StoryStudioPage").then((m) => ({ default: m.StoryStudioPage })));
const ListingStudioPage = lazy(() => import("./pages/ListingStudioPage").then((m) => ({ default: m.ListingStudioPage })));
const NewListingPage = lazy(() => import("./pages/NewListingPage").then((m) => ({ default: m.NewListingPage })));
const ThanksPage = lazy(() => import("./pages/ThanksPage").then((m) => ({ default: m.ThanksPage })));
const MapLayerPage = lazy(() => import("./pages/MapLayerPage").then((m) => ({ default: m.MapLayerPage })));

export default function App() {
  const { ready, profile, site } = useApp();
  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LogoMark className="h-14 w-14 animate-pulse" />
      </div>
    );
  }
  if (!profile || !site) return <LoginPage />;
  return (
    <AppShell>
      <Suspense fallback={<LogoMark className="mx-auto mt-20 h-10 w-10 animate-pulse" />}>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/saker" element={<SakerPage />} />
        <Route path="/manniskor" element={<ManniskorPage />} />
        <Route path="/platser" element={<PlatserPage />} />
        <Route path="/platser/projekt" element={<ProjectsPage />} />
        <Route path="/projekt/:id" element={<ProjectPage />} />
        <Route path="/plats/:id" element={<ExternalPlacePage />} />
        <Route path="/platser/kartlager/ny" element={<MapLayerPage />} />
        {/* Äldre adresser från när Samla rymde både saker och människor */}
        <Route path="/samla" element={<OldSamla />} />
        <Route path="/vreta" element={<Navigate to="/platser" replace />} />
        <Route path="/vreta/kartlager/ny" element={<Navigate to="/platser/kartlager/ny" replace />} />
        <Route path="/fanga" element={<CapturePage />} />
        <Route path="/granska" element={<ReviewListPage />} />
        <Route path="/granska/:id" element={<ProposalPage />} />
        <Route path="/objekt/:id" element={<ObjectPage />} />
        <Route path="/objekt/:id/beratta" element={<StoryStudioPage />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/zon/:id" element={<ZonePage />} />
        <Route path="/person/:id" element={<PersonPage />} />
        <Route path="/person/:id/tacka" element={<ThanksPage />} />
        <Route path="/annons/ny" element={<NewListingPage />} />
        <Route path="/annons/:id" element={<ListingStudioPage />} />
        <Route path="/hamtning/ny" element={<NewPickupPage />} />
        <Route path="/hamtning/:id" element={<PickupPage />} />
        <Route path="/lager" element={<StoragePage />} />
        <Route path="/lager/etiketter" element={<LabelsPage />} />
        <Route path="/lager/:id" element={<StorageLocationPage />} />
        <Route path="/fraga" element={<AskPage />} />
        <Route path="/installningar" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </AppShell>
  );
}

function OldSamla() {
  const vy = new URLSearchParams(useLocation().search).get("vy");
  return <Navigate to={vy === "manniskor" ? "/manniskor" : vy ? `/saker?vy=${vy}` : "/saker"} replace />;
}
