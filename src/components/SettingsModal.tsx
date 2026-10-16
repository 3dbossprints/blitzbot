import { useState } from "react";
import { useStore } from "../lib/store";
import { manualGroups } from "../lib/router";
import type { ProviderId } from "../lib/types";

function ModelStatus({ provider }: { provider: ProviderId }) {
  const models = useStore((s) => s.models[provider]);
  const error = useStore((s) => s.modelErrors[provider]);
  if (error) return <p className="field-hint error-hint">couldn't fetch models: {error}</p>;
  if (models?.length) return <p className="field-hint ok-hint">{models.length} models available</p>;
  return null;
}

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const keys = useStore((s) => s.keys);
  const setKeys = useStore((s) => s.setKeys);
  const models = useStore((s) => s.models);
  const refreshModels = useStore((s) => s.refreshModels);
  const autoRoute = useStore((s) => s.autoRoute);
  const autoReadme = useStore((s) => s.autoReadme);
  const warnHeavy = useStore((s) => s.warnHeavy);
  const maxCostUsd = useStore((s) => s.maxCostUsd);
  const manualChoice = useStore((s) => s.manualChoice);
  const compareModels = useStore((s) => s.compareModels);
  const toggleCompareModel = useStore((s) => s.toggleCompareModel);
  const setPref = useStore((s) => s.setPref);
  const error = useStore((s) => s.error);
  const files = useStore((s) => s.files);
  const editFile = useStore((s) => s.editFile);
  const [backendStatus, setBackendStatus] = useState<string>("");
  const [localAiEnabled, setLocalAiEnabled] = useState(() => { try { return localStorage.getItem("blitzbot.browser-ai.enabled") === "true"; } catch { return false; } });
  const [localModel, setLocalModel] = useState(() => { try { return localStorage.getItem("blitzbot.browser-ai.model") || "onnx-community/Qwen2.5-Coder-1.5B-Instruct"; } catch { return "onnx-community/Qwen2.5-Coder-1.5B-Instruct"; } });
  const [backendBusy, setBackendBusy] = useState(false);
  const [basePrompt, setBasePrompt] = useState(() => { try { return localStorage.getItem("blitzbot.base-prompt.v1") ?? ""; } catch { return ""; } });
  const [skills, setSkills] = useState<{ id: string; name: string; content: string; enabled: boolean }[]>(() => {
    try { return JSON.parse(localStorage.getItem("blitzbot.skills.v1") ?? "[]"); } catch { return []; }
  });
  const [integrationSettings, setIntegrationSettings] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("blitzbot.integrations.v1") ?? "{}"); } catch { return {}; }
  });
  const [settingsNotice, setSettingsNotice] = useState("");
  function saveIntegrationSettings(next: Record<string, string>) {
    setIntegrationSettings(next);
    try { localStorage.setItem("blitzbot.integrations.v1", JSON.stringify(next)); } catch {}
  }
  async function importSkills(files: FileList | null) {
    if (!files?.length) return;
    const added: { id: string; name: string; content: string; enabled: boolean }[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 100_000) { setSettingsNotice("Skipped " + file.name + ": skill files must be under 100 KB."); continue; }
      try { added.push({ id: crypto.randomUUID(), name: file.name, content: await file.text(), enabled: true }); }
      catch { setSettingsNotice("Could not read " + file.name + "."); }
    }
    setSkills((current) => {
      const next = [...current, ...added];
      try { localStorage.setItem("blitzbot.skills.v1", JSON.stringify(next)); } catch { setSettingsNotice("Browser storage is full; remove a large skill and try again."); }
      return next;
    });
  }

  async function testBackend(kind: "supabase" | "appwrite") {
    setBackendBusy(true);
    setBackendStatus("");
    try {
      let response: Response;
      if (kind === "supabase") {
        if (!keys.supabaseUrl.trim() || !keys.supabaseKey.trim()) throw new Error("Enter your Supabase project URL and publishable key first.");
        const base = keys.supabaseUrl.trim().replace(/\/+$/, "");
        response = await fetch(`${base}/auth/v1/health`, { headers: { apikey: keys.supabaseKey.trim() } });
      } else {
        if (!keys.appwriteEndpoint.trim() || !keys.appwriteProjectId.trim()) throw new Error("Enter your Appwrite endpoint and project ID first.");
        const base = keys.appwriteEndpoint.trim().replace(/\/+$/, "");
        response = await fetch(`${base}/health`, { headers: { "X-Appwrite-Project": keys.appwriteProjectId.trim() } });
      }
      if (!response.ok) throw new Error(`The service replied with HTTP ${response.status}. Check the URL, project settings, and browser CORS/platform configuration.`);
      setBackendStatus(`${kind === "supabase" ? "Supabase" : "Appwrite"} connection successful.`);
    } catch (e) {
      setBackendStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBackendBusy(false);
    }
  }

  function applyBackendEnv() {
    if (!keys.supabaseUrl.trim() && !keys.supabaseKey.trim() && !(keys.appwriteEndpoint.trim() && keys.appwriteProjectId.trim())) {
      setBackendStatus("Enter at least one backend configuration before applying it.");
      return;
    }
    const existing = files[".env.local"] ?? "";
    const managed = new Map<string, string>();
    if (keys.supabaseUrl.trim()) managed.set("VITE_SUPABASE_URL", keys.supabaseUrl.trim());
    if (keys.supabaseKey.trim()) managed.set("VITE_SUPABASE_ANON_KEY", keys.supabaseKey.trim());
    if (keys.appwriteEndpoint.trim() && keys.appwriteProjectId.trim()) {
      managed.set("VITE_APPWRITE_ENDPOINT", keys.appwriteEndpoint.trim());
      managed.set("VITE_APPWRITE_PROJECT_ID", keys.appwriteProjectId.trim());
    }
    const untouched = existing.split("\n").filter((line) => !managed.has(line.split("=", 1)[0]));
    editFile(".env.local", [...untouched.filter(Boolean), ...Array.from(managed, ([key, value]) => `${key}=${value}`)].join("\n") + "\n");
    setBackendStatus("Added backend settings to .env.local in the current project. Restart the dev server to load the new environment variables.");
  }

  if (!open) return null;
  const groups = manualGroups(keys, models);
  const ollamaList = models.ollama ?? [];
  const openrouterList = models.openrouter ?? [];
  const isPicked = (provider: ProviderId, model: string) =>
    compareModels.some((c) => c.provider === provider && c.model === model);

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Keys & models</h2>
          <button className="quiet-link as-button" onClick={() => setOpen(false)}>
            close
          </button>
        </div>

        <p className="trust-note">
          AI credentials are stored in this browser's localStorage and sent only to the provider you select.
          Projects and chats are saved on this device (IndexedDB), never uploaded. There is no
          BlitzBot server — check the network tab.
        </p>
        {error && <p className="modal-error">{error}</p>}
        <section className="browser-ai-settings">
          <div className="field-row"><span className="field-label-strong">Browser-local coding AI (optional)</span></div>
          <p className="field-hint">Runs in this browser with no personal API key. Model weights download only when first enabled and used. First load may take a while and needs storage and available memory.</p>
          <label className="check"><input type="checkbox" checked={localAiEnabled} onChange={(e) => {
            const enabled = e.target.checked; setLocalAiEnabled(enabled);
            try { localStorage.setItem("blitzbot.browser-ai.enabled", String(enabled)); } catch {}
            if (enabled) setPref({ autoRoute: false, manualChoice: { provider: "web-local", model: localModel } });
            else { setPref({ autoRoute: true, manualChoice: null }); void import("../lib/providers").then((m) => m.unloadBrowserLocalModel()); }
          }} /><span>Enable browser-local AI as my selected provider</span></label>
          <label className="field"><span>Model size</span><select value={localModel} onChange={(e) => {
            const model = e.target.value; setLocalModel(model);
            try { localStorage.setItem("blitzbot.browser-ai.model", model); } catch {}
            if (localAiEnabled) setPref({ autoRoute: false, manualChoice: { provider: "web-local", model } });
          }}><option value="onnx-community/Qwen2.5-Coder-1.5B-Instruct">Small · ~2B class, recommended</option><option value="onnx-community/Qwen2.5-Coder-3B-Instruct">Larger · up to ~6 GB device memory</option></select></label>
          <p className="field-hint">This provider is only selected when you enable it. Turn it off to return to automatic routing. Device compatibility and memory use vary.</p>
        </section>

        <div className="field-row"><span className="field-label-strong">Backend connections for your generated app</span></div>
        <p className="field-hint">These settings are saved in this browser. They configure generated projects; they do not connect BlitzBot's own project history to a remote database. Only use public client credentials here.</p>
        <label className="field">
          <span>Supabase project URL</span>
          <input value={keys.supabaseUrl} onChange={(e) => setKeys({ supabaseUrl: e.target.value.trim() })} placeholder="https://your-project.supabase.co" autoComplete="off" />
        </label>
        <label className="field">
          <span>Supabase publishable key (or legacy anon key)</span>
          <input type="password" value={keys.supabaseKey} onChange={(e) => setKeys({ supabaseKey: e.target.value.trim() })} placeholder="sb_publishable_… or anon key" autoComplete="off" />
        </label>
        <button className="quiet-link as-button" disabled={backendBusy} onClick={() => void testBackend("supabase")}>{backendBusy ? "Testing…" : "Test Supabase connection"}</button>
        <label className="field">
          <span>Appwrite endpoint</span>
          <input value={keys.appwriteEndpoint} onChange={(e) => setKeys({ appwriteEndpoint: e.target.value.trim() })} placeholder="https://cloud.appwrite.io/v1" autoComplete="off" />
        </label>
        <label className="field">
          <span>Appwrite project ID</span>
          <input value={keys.appwriteProjectId} onChange={(e) => setKeys({ appwriteProjectId: e.target.value.trim() })} placeholder="Project ID from Appwrite Console" autoComplete="off" />
        </label>
        <button className="quiet-link as-button" disabled={backendBusy} onClick={() => void testBackend("appwrite")}>{backendBusy ? "Testing…" : "Test Appwrite connection"}</button>
        <button className="quiet-link as-button" onClick={applyBackendEnv}>Apply configured values to current app (.env.local)</button>
        {backendStatus && <p className="field-hint">{backendStatus}</p>}
        <p className="field-hint">Never paste a Supabase secret/service-role key or an Appwrite server API key here. For Supabase, enable Row Level Security and restrict policies. Add your deployed hostname as a Web platform in Appwrite Console.</p>

        <label className="field">
          <span>OpenAI API key</span>
          <input
            type="password"
            value={keys.openai}
            onChange={(e) => setKeys({ openai: e.target.value.trim() })}
            onBlur={() => void refreshModels("openai")}
            placeholder="sk-…"
            autoComplete="off"
          />
        </label>
        <ModelStatus provider="openai" />

        <label className="field">
          <span>Anthropic API key</span>
          <input
            type="password"
            value={keys.anthropic}
            onChange={(e) => setKeys({ anthropic: e.target.value.trim() })}
            onBlur={() => void refreshModels("anthropic")}
            placeholder="sk-ant-…"
            autoComplete="off"
          />
        </label>
        <ModelStatus provider="anthropic" />

        <label className="field">
          <span>OpenRouter API key</span>
          <input
            type="password"
            value={keys.openrouter}
            onChange={(e) => setKeys({ openrouter: e.target.value.trim() })}
            onBlur={() => void refreshModels("openrouter")}
            placeholder="sk-or-…"
            autoComplete="off"
          />
        </label>
        <ModelStatus provider="openrouter" />
        {keys.openrouter && (
          <label className="field">
            <span>OpenRouter model (auto-route uses this; type to search)</span>
            <input
              list="openrouter-models"
              value={keys.openrouterModel}
              onChange={(e) => setKeys({ openrouterModel: e.target.value.trim() })}
              placeholder="openai/gpt-4o"
            />
            <datalist id="openrouter-models">
              {openrouterList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </datalist>
          </label>
        )}

        <label className="field">
          <span>Local model URL (Ollama / LM Studio, OpenAI-compatible)</span>
          <input
            value={keys.ollamaUrl}
            onChange={(e) => setKeys({ ollamaUrl: e.target.value.trim() })}
            onBlur={() => void refreshModels("ollama")}
            placeholder="http://localhost:1234/v1 (LM Studio) or :11434/v1 (Ollama)"
          />
        </label>
        <ModelStatus provider="ollama" />
        {keys.ollamaUrl && (
          <label className="field">
            <span>Local model</span>
            {ollamaList.length > 0 ? (
              <select value={keys.ollamaModel} onChange={(e) => setKeys({ ollamaModel: e.target.value })}>
                {ollamaList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={keys.ollamaModel}
                onChange={(e) => setKeys({ ollamaModel: e.target.value.trim() })}
                placeholder="llama3.1"
              />
            )}
          </label>
        )}
        {keys.ollamaUrl && (
          <p className="field-hint">
            <strong>LM Studio:</strong> start the local server in the Developer tab, enable CORS for browser access, and use <code>http://localhost:1234/v1</code>.{" "}
            <strong>Ollama:</strong> allow this origin with <code>OLLAMA_ORIGINS={location.origin} ollama serve</code> and use <code>http://localhost:11434/v1</code>.
          </p>
        )}

        <div className="field-row">
          <label className="check">
            <input
              type="checkbox"
              checked={autoRoute}
              onChange={(e) => setPref({ autoRoute: e.target.checked })}
            />
            <span>Auto-route: pick the best model per task from your available models</span>
          </label>
        </div>
        {!autoRoute && (
          <label className="field">
            <span>Model — everything your keys unlock</span>
            <select
              value={manualChoice ? `${manualChoice.provider}::${manualChoice.model}` : ""}
              onChange={(e) => {
                const idx = e.target.value.indexOf("::");
                if (idx === -1) return;
                const provider = e.target.value.slice(0, idx) as ProviderId;
                const model = e.target.value.slice(idx + 2);
                if (provider && model) setPref({ manualChoice: { provider, model } });
              }}
            >
              <option value="" disabled>
                choose…
              </option>
              {groups.map((g) => (
                <optgroup key={g.provider} label={g.label}>
                  {g.options.map((o) => (
                    <option key={`${g.provider}::${o.id}`} value={`${g.provider}::${o.id}`}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        <div className="field-row">
          <span className="field-label-strong">Cost controls</span>
        </div>
        <div className="field-row">
          <label className="check">
            <input
              type="checkbox"
              checked={warnHeavy}
              onChange={(e) => setPref({ warnHeavy: e.target.checked })}
            />
            <span>Warn before heavy builds on paid models (shows a ballpark cost first)</span>
          </label>
        </div>
        <label className="field">
          <span>Hard cost cap per message (USD) — aborts the stream if the estimate passes it</span>
          <input
            type="number"
            min="0"
            step="0.05"
            value={maxCostUsd ?? ""}
            onChange={(e) =>
              setPref({ maxCostUsd: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })
            }
            placeholder="off"
          />
        </label>
        <p className="field-hint">
          Enforced from token estimates, so only models with known pricing (see src/lib/pricing.ts)
          can trip it. Aborted builds keep whatever files already finished.
        </p>

        <div className="field-row">
          <span className="field-label-strong">Compare candidates (pick 2–3)</span>
        </div>
        <div className="compare-picker">
          {groups.length === 0 && <p className="field-hint">Add a key to pick candidates.</p>}
          {groups.map((g) => (
            <div key={g.provider} className="compare-group">
              <div className="compare-group-label">{g.label}</div>
              {g.options.slice(0, 12).map((o) => {
                const picked = isPicked(g.provider, o.id);
                return (
                  <label key={o.id} className={`check compare-check ${picked ? "picked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={!picked && compareModels.length >= 3}
                      onChange={() =>
                        toggleCompareModel({ provider: g.provider, model: o.id, label: o.label })
                      }
                    />
                    <span>{o.label}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <p className="field-hint">
          Toggle "⇄ compare" on the input to race these on your next build and pick the winner. Each
          candidate bills its own tokens.
        </p>
        <section className="settings-section">
          <h3>Deployment</h3>
          <p className="field-hint">Save tokens for later deployment integration. This does not deploy a project by itself.</p>
          <label className="field"><span>Vercel access token</span><input type="password" value={integrationSettings.vercelToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, vercelToken: e.target.value })} placeholder="Vercel token" autoComplete="off" /></label>
          <label className="field"><span>Netlify access token</span><input type="password" value={integrationSettings.netlifyToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, netlifyToken: e.target.value })} placeholder="Netlify token" autoComplete="off" /></label>
        </section>
        <section className="settings-section">
          <h3>GitLab</h3>
          <label className="field"><span>GitLab personal access token</span><input type="password" value={integrationSettings.gitlabToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, gitlabToken: e.target.value })} placeholder="glpat-…" autoComplete="off" /></label>
          <p className="field-hint">GitLab API actions need a server-side integration before this token can be used to push or import repositories.</p>
        </section>
        <section className="settings-section">
          <h3>Custom MCP</h3>
          <label className="field"><span>MCP bridge endpoint</span><input value={integrationSettings.mcpUrl ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, mcpUrl: e.target.value })} placeholder="https://your-mcp-bridge.example.com" /></label>
          <p className="field-hint">This saves an endpoint for setup. An active MCP session requires a trusted server-side bridge; entering a URL alone does not connect it.</p>
        </section>
        <section className="settings-section">
          <h3>Base prompt</h3>
          <p className="field-hint">Persistent instructions appended to the built-in prompt for future coding and ideation requests.</p>
          <label className="field"><span>Your instructions</span><textarea rows={6} value={basePrompt} onChange={(e) => { setBasePrompt(e.target.value); try { localStorage.setItem("blitzbot.base-prompt.v1", e.target.value); } catch {} }} placeholder="Prefer accessible React components, TypeScript, and minimal dependencies…" /></label>
        </section>
        <section className="settings-section">
          <h3>Skills</h3>
          <p className="field-hint">Upload .md, .txt, or .json instructions (under 100 KB each). Enabled skills are included in future model context and stored in this browser.</p>
          <label className="field"><span>Upload skill files</span><input type="file" accept=".md,.txt,.json,text/plain,text/markdown,application/json" multiple onChange={(e) => { void importSkills(e.target.files); e.currentTarget.value = ""; }} /></label>
          {skills.map((skill) => <div className="skill-row" key={skill.id}>
            <label className="check"><input type="checkbox" checked={skill.enabled} onChange={(e) => setSkills((current) => { const next = current.map((s) => s.id === skill.id ? { ...s, enabled: e.target.checked } : s); try { localStorage.setItem("blitzbot.skills.v1", JSON.stringify(next)); } catch {} return next; })} /><span>{skill.name}</span></label>
            <button className="quiet-link as-button" onClick={() => setSkills((current) => { const next = current.filter((s) => s.id !== skill.id); try { localStorage.setItem("blitzbot.skills.v1", JSON.stringify(next)); } catch {} return next; })}>Remove</button>
          </div>)}
          {settingsNotice && <p className="field-hint">{settingsNotice}</p>}
        </section>


        <div className="field-row">
          <label className="check">
            <input
              type="checkbox"
              checked={autoReadme}
              onChange={(e) => setPref({ autoReadme: e.target.checked })}
            />
            <span>Write a README.md after each build</span>
          </label>
        </div>

        <label className="field">
          <span>GitHub personal access token (for push / PRs / private imports)</span>
          <input
            type="password"
            value={keys.github}
            onChange={(e) => setKeys({ github: e.target.value.trim() })}
            placeholder="github_pat_… or ghp_…"
            autoComplete="off"
          />
        </label>
        <p className="field-hint">
          Needs repo scope. Sent only to api.github.com. Fine-grained tokens: grant "Contents:
          read/write" and "Pull requests: read/write" on the repos you'll use.
        </p>
      </div>
    </div>
  );
}
