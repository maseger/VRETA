import { Component, type ReactNode } from "react";

// Fångar renderingsfel så att en trasig sida inte tar ner hela appen.
export class ErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.inline ? "py-8" : "flex min-h-screen items-center justify-center bg-kalk p-6"}>
        <div className="card card-pad max-w-md text-center">
          <h1 className="mb-2 text-2xl">Något gick fel</h1>
          <p className="mb-4 text-sot-2">Sidan kunde inte visas. Det du sparat finns kvar.</p>
          <pre className="mb-4 overflow-x-auto whitespace-pre-wrap text-left text-xs text-sot-3">{this.state.error.message}</pre>
          <button type="button" className="btn-primary" onClick={() => { this.setState({ error: null }); location.hash = "#/"; }}>Till Idag</button>
        </div>
      </div>
    );
  }
}
