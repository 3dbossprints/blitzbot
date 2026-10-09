import { useState } from "react";
import { useStore } from "../lib/store";
import { hasAnyKey } from "../lib/providers";
import { route } from "../lib/router";
import { timeAgo } from "../lib/db";
import { fetchRepoFiles } from "../lib/github";
import { STARTER_TEMPLATES } from "../lib/templates";

const TEMPLATES = STARTER_TEMPLATES;

function parseRepo(input: string): string | null {
  const url = input.match(/github\.com\/([\w.-]+\/[\w.-]+)/);
  if (url) return url[1].replace(/\.git$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(input.trim())) return input.trim();
  return null;
}

function ImportForm() {
  const keys = useStore((s) => s.keys);
  const adopt = useStore((s) => s.adoptImportedRepo);
  const [value, setValue] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    const repo = parseRepo(value);
    if (!repo) {
      setError("Use owner/repo or a full GitHub URL.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress("fetching file tree…");
    try {
      const res = await fetchRepoFiles(keys.github, repo, (done, total) =>
        setProgress(`fetching files… ${done}/${total}`),
      );
      setProgress(null);
      await adopt(res.files, repo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-form">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !busy && void run()}
        placeholder="owner/repo or https://github.com/…"
        aria-label="GitHub repository to import"
        disabled={busy}
      />
      <button className="btn-ghost btn-sm" onClick={() => void run()} disabled={busy || !value.trim()}>
        {busy ? "Importing…" : "Import"}
      </button>
      {progress && <span className="import-status mono">{progress}</span>}
      {error && <span className="import-error mono">{error}</span>}
      {!keys.github && (
        <span className="import-status mono">public repos only — add a GitHub token for private</span>
      )}
    </div>
  );
}

export function Landing({ onNavigate }: { onNavigate: (page: "home" | "build" | "chat") => void }) {
  const [value, setValue] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const keys = useStore((s) => s.keys);
  const models = useStore((s) => s.models);
  const dispatch = useStore((s) => s.dispatch);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const autoRoute = useStore((s) => s.autoRoute);
  const manualChoice = useStore((s) => s.manualChoice);
  const mode = useStore((s) => s.mode);
  const setPref = useStore((s) => s.setPref);
  const compareOn = useStore((s) => s.compareOn);
  const compareModels = useStore((s) => s.compareModels);
  const projects = useStore((s) => s.projects);
  const openProject = useStore((s) => s.openProject);
  const adoptImportedRepo = useStore((s) => s.adoptImportedRepo);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);

  const keysReady = hasAnyKey(keys);
  const preview =
    value.trim() && keysReady && autoRoute && mode === "build" ? route(value, keys, models) : null;
  const recent = projects.slice(0, 5);
  const compareReady = compareModels.length >= 2;

  function submit() {
    const prompt = value.trim();
    if (!prompt) return;
    if (!keysReady) {
      setSettingsOpen(true);
      return;
    }
    onNavigate("build");
    dispatch(prompt);
  }

  return (
    <div className="landing">
      <header className="landing-bar">
        <span className="wordmark">
          <em>Blitz</em>Bot
        </span>
        <nav className="landing-nav">
          <a href="https://github.com/3dbossprints/blitzbot" target="_blank" rel="noreferrer" className="quiet-link">
            Source
          </a>
          <button className="quiet-link as-button" onClick={() => onNavigate("build")}>Build</button>
          <button className="quiet-link as-button" onClick={() => onNavigate("chat")}>Chat</button>
          <button className="quiet-link as-button" onClick={() => setSettingsOpen(true)}>Keys</button>
        </nav>
      </header>

      <main className="landing-main">
        <h1 className="hero-q">
          {mode === "ideate" ? "What are you thinking about?" : "What do you want to build?"}
        </h1>
        <div className="hero-input-wrap">
          <input
            className="hero-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={
              mode === "ideate" ? "should I use websockets or polling for…" : "a kanban board with drag and drop…"
            }
            aria-label={mode === "ideate" ? "Describe what to discuss" : "Describe the app to build"}
          />
          <button className="hero-go" onClick={submit} disabled={!value.trim()}>
            {mode === "ideate" ? "ideate ↵" : "build ↵"}
          </button>
        </div>

        <div className="hero-hints">
          <span className="mode-seg" role="radiogroup" aria-label="Mode">
            <button className={`mode-btn ${mode === "build" ? "on" : ""}`} onClick={() => setPref({ mode: "build" })}>
              Build
            </button>
            <button className={`mode-btn ${mode === "ideate" ? "on" : ""}`} onClick={() => setPref({ mode: "ideate" })}>
              Ideate
            </button>
          </span>
          <button className="chip as-button" onClick={() => setSettingsOpen(true)}>
            {keysReady ? "keys ✓" : "add a key to start"}
          </button>
          <span className="chip">
            {autoRoute ? (preview ? `auto → ${preview.model}` : "model: auto") : `model: ${manualChoice?.model ?? "auto"}`}
          </span>
          {mode === "build" && compareReady && (
            <button
              className={`chip as-button ${compareOn ? "chip-on" : ""}`}
              onClick={() => setPref({ compareOn: !compareOn })}
              title="Race your compare candidates and pick the winner"
            >
              ⇄ compare {compareModels.length}
            </button>
          )}
          <span className="chip ghost">runs entirely in your browser</span>
        </div>

        {mode === "build" && (
          <section className="template-gallery" aria-label="Starter templates">
            <div className="template-gallery-head">
              <h2>Start with a template</h2>
              <p>Choose a starting point, then customize it with your prompt.</p>
            </div>
            {["Popular", "Websites", "Apps", "Full stack", "Frameworks"].map((category) => (
              <div className="template-category" key={category}>
                <h3>{category}</h3>
                <div className="template-grid">
                  {TEMPLATES.filter((template) => template.category === category).map((template) => (
                    <button
                      key={template.title}
                      className="template-card as-button"
                      onClick={() => {
                        setLoadingTemplate(template.id);
                        void adoptImportedRepo(template.files, `BlitzBot ${template.title}`).then(() => onNavigate("build")).finally(() => setLoadingTemplate(null));
                      }}
                      aria-label={`Use ${template.title} template`}
                    >
                      <span className="template-art" aria-hidden="true">
                        <span className="template-art-bar" />
                        <span className="template-art-line" />
                        <span className="template-art-line short" />
                        <span className="template-art-blocks"><i /><i /><i /></span>
                      </span>
                      <span className="template-card-title">{loadingTemplate === template.id ? "Opening…" : template.title}</span>
                      <span className="template-card-stack">{template.stack}</span>
                      <span className="template-card-stack">{template.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        <div className="import-row">
          <button className="quiet-link as-button" onClick={() => setImportOpen(!importOpen)}>
            {importOpen ? "× close import" : "or import a GitHub repo →"}
          </button>
          {importOpen && <ImportForm />}
        </div>

        {recent.length > 0 && (
          <section className="recent" aria-label="Recent projects">
            <div className="recent-head">Recent — saved on this device</div>
            <ul className="recent-list">
              {recent.map((p) => (
                <li key={p.id}>
                  <button className="recent-row as-button" onClick={() => void openProject(p.id)}>
                    <span className="recent-title">{p.title}</span>
                    <span className="recent-meta">
                      {p.fileCount} files · {timeAgo(p.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="landing-foot">
        <p>
          Open source. Your workspace data stays on this machine. Generated apps can connect to Supabase or Appwrite when you configure them — verify requests in the network tab.
        </p>
      </footer>
    </div>
  );
}
