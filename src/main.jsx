import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("BuildLens React render failure:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <main style={{ minHeight: "100dvh", boxSizing: "border-box", padding: "32px", background: "#111315", color: "#e8ebee", fontFamily: "system-ui,sans-serif" }}>
        <h1 style={{ fontSize: "20px" }}>BuildLens couldn't render</h1>
        <p style={{ color: "#aab4bb" }}>React encountered an error while building the workspace.</p>
        <pre style={{ maxWidth: "100%", overflow: "auto", whiteSpace: "pre-wrap", padding: "16px", background: "#1c2024", border: "1px solid #41484e", color: "#f0c4bd", fontSize: "12px" }}>{String(this.state.error?.stack || this.state.error)}</pre>
        <button onClick={() => window.location.reload()} style={{ padding: "9px 14px", background: "#c8d4db", color: "#111315", border: 0 }}>Reload workspace</button>
      </main>;
    }
    return this.props.children;
  }
}

function BootComplete() {
  useEffect(() => {
    document.getElementById("boot-status")?.remove();
  }, []);
  return null;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  window.__buildLensShowBootError?.("The HTML page is missing the #root element.");
} else {
  createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
      <BootComplete />
    </React.StrictMode>
  );
}