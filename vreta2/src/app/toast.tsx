import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; kind: "ok" | "error" | "info" };
const Ctx = createContext<{ toast: (text: string, kind?: Toast["kind"]) => void }>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto max-w-md rounded-lg px-4 py-3 text-[15px] shadow-upphojd ${t.kind === "error" ? "bg-rust-pressed text-white" : t.kind === "info" ? "bg-bark text-cream" : "bg-forest text-cream"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx).toast;
}
