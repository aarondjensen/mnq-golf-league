import { Component } from "react";
import { K } from "./theme";

// ErrorBoundary catches runtime errors in any child component tree and renders a
// friendly fallback instead of a blank white screen. Lazy-loaded pages (see App.jsx)
// are wrapped in this boundary; when the user navigates to a different tab, the
// keyed wrapper in App.jsx remounts the boundary and the error state clears
// automatically — so a crashed page self-heals on navigation.
//
// React's error boundary API requires a class component (no hook equivalent for
// componentDidCatch / getDerivedStateFromError). That's the only reason this isn't
// a functional component like the rest of the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Surface the error to browser devtools and Vercel logs. If we ever wire up
    // external error reporting (Sentry etc.), it'd go here too.
    console.error("[ErrorBoundary] Caught error in lazy-loaded page:", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "40px 20px", minHeight: 300,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 42, marginBottom: 12, opacity: 0.5 }}>⚠</div>
        <div style={{
          fontSize: 16, fontWeight: 700, color: K.t1,
          letterSpacing: 0.5, marginBottom: 6,
        }}>
          Something went wrong
        </div>
        <div style={{
          fontSize: 12, color: K.t3, maxWidth: 300,
          lineHeight: 1.5, marginBottom: 20,
        }}>
          This page hit an unexpected error. Try switching tabs, or reload the app.
        </div>
        <button onClick={() => window.location.reload()} style={{
          padding: "10px 20px", borderRadius: 8,
          background: K.act, border: "none",
          color: K.bg, fontSize: 13, fontWeight: 700,
          cursor: "pointer", letterSpacing: 0.4,
        }}>
          Reload App
        </button>
        {/* In dev, show the actual error so it's debuggable. Production users see
            only the friendly message above. */}
        {import.meta.env.DEV && this.state.error && (
          <pre style={{
            marginTop: 20, padding: 10, background: K.card,
            border: `1px solid ${K.bdr}`, borderRadius: 6,
            fontSize: 10, color: K.red, maxWidth: 400,
            overflow: "auto", textAlign: "left",
            whiteSpace: "pre-wrap", fontFamily: "monospace",
            textTransform: "none", letterSpacing: 0,
          }}>
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}