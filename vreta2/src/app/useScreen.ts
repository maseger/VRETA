import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { setScreen } from "./screen";

// Detaljsidor registrerar vad som visas – används av Fånga och Fråga Vreta.
export function useScreen(entity: { id?: string | null; type?: string | null; title?: string | null } | null | undefined) {
  const loc = useLocation();
  useEffect(() => {
    if (entity?.id) setScreen({ route: loc.pathname, entity_id: entity.id, entity_type: entity.type ?? undefined, title: entity.title ?? undefined });
  }, [entity?.id, entity?.type, entity?.title, loc.pathname]);
}
