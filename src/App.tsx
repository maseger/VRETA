import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./app/AppContext";
import { AppShell } from "./ui/AppShell";
import { LogoMark } from "./ui/Logo";
import { AskPage } from "./pages/AskPage";
import { CapturePage } from "./pages/CapturePage";
import { LabelsPage } from "./pages/LabelsPage";
import { LoginPage } from "./pages/LoginPage";
import { NewPickupPage } from "./pages/NewPickupPage";
import { PersonPage } from "./pages/PersonPage";
import { PickupPage } from "./pages/PickupPage";
import { StorageLocationPage } from "./pages/StorageLocationPage";
import { StoragePage } from "./pages/StoragePage";
import { ObjectPage } from "./pages/ObjectPage";
import { ProposalPage } from "./pages/ProposalPage";
import { ReviewListPage } from "./pages/ReviewListPage";
import { SamlaPage } from "./pages/SamlaPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StoryStudioPage } from "./pages/StoryStudioPage";
import { TodayPage } from "./pages/TodayPage";
import { VretaPage } from "./pages/VretaPage";

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
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/samla" element={<SamlaPage />} />
        <Route path="/fanga" element={<CapturePage />} />
        <Route path="/granska" element={<ReviewListPage />} />
        <Route path="/granska/:id" element={<ProposalPage />} />
        <Route path="/objekt/:id" element={<ObjectPage />} />
        <Route path="/objekt/:id/beratta" element={<StoryStudioPage />} />
        <Route path="/vreta" element={<VretaPage />} />
        <Route path="/person/:id" element={<PersonPage />} />
        <Route path="/hamtning/ny" element={<NewPickupPage />} />
        <Route path="/hamtning/:id" element={<PickupPage />} />
        <Route path="/lager" element={<StoragePage />} />
        <Route path="/lager/etiketter" element={<LabelsPage />} />
        <Route path="/lager/:id" element={<StorageLocationPage />} />
        <Route path="/fraga" element={<AskPage />} />
        <Route path="/installningar" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
