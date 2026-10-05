import { Component, type ErrorInfo, type ReactNode } from "react";

const RELOADED_KEY = "vreta-chunk-reload";

/** Visar ett begripligt fel i stället för en tom sida, med möjlighet att ladda om. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("VRETA kraschade:", error, info.componentStack);
    // Efter en ny publicering kan en gammal flik försöka ladda filer som inte längre finns: ladda om en gång
    if (/dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message)) {
      try {
        if (!sessionStorage.getItem(RELOADED_KEY)) {
          sessionStorage.setItem(RELOADED_KEY, "1");
          window.location.reload();
        }
      } catch {
        /* utan sessionStorage visas felrutan */
      }
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="card w-full max-w-md space-y-4 p-6" role="alert">
          <h1 className="text-2xl">Något gick fel</h1>
          <p className="text-sot-2">Sidan kunde inte visas. Ladda om och försök igen. Händer det igen, ta en skärmbild av rutan nedan.</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-kalk-2 p-3 text-[12px] text-sot-2">{`${error.name}: ${error.message}\n${(error.stack ?? "").split("\n").slice(1, 5).join("\n")}`}</pre>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => window.location.reload()}>Ladda om</button>
            <a className="btn-secondary" href={import.meta.env.BASE_URL}>Till startsidan</a>
          </div>
        </div>
      </div>
    );
  }
}
