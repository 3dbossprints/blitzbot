import { useState } from "react";
import { useStore } from "../lib/store";
import { manualGroups } from "../lib/router";
import { connectMcp, type McpTool } from "../lib/mcp";
import { buildProjectAssets } from "../lib/webcontainer";
import { deployToNetlify, deployToVercel } from "../lib/deploy";
import type { ProviderId } from "../lib/types";

function ModelStatus({ provider }: { provider: ProviderId }) {
  const models = useStore((s) => s.models[provider]);
  const error = useStore((s) => s.modelErrors[provider]);
  if (error) return <p className="field-hint error-hint">couldn't fetch models: {error}</p>;
  if (models?.length) return <p className="field-hint ok-hint">{models.length} models available</p>;
  return null;
}

type SettingsIconName = "cpu" | "database" | "deploy" | "git" | "mcp" | "prompt" | "skills";
function SettingsIcon({ name }: { name: SettingsIconName }) {
  const paths: Record<SettingsIconName, string> = {
    cpu: "M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M8 8h8v8H8z M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
    database: "M4.5 6.75C4.5 5.507 7.858 4.5 12 4.5s7.5 1.007 7.5 2.25S16.142 9 12 9 4.5 7.993 4.5 6.75Zm0 0v10.5c0 1.243 3.358 2.25 7.5 2.25s7.5-1.007 7.5-2.25V6.75M4.5 12c0 1.243 3.358 2.25 7.5 2.25s7.5-1.007 7.5-2.25",
    deploy: "M12 16V4m0 0 4 4m-4-4L8 8M4.5 14.25v3A2.25 2.25 0 0 0 6.75 19.5h10.5a2.25 2.25 0 0 0 2.25-2.25v-3",
    git: "M6 3.75A2.25 2.25 0 1 0 6 8.25a2.25 2.25 0 0 0 0-4.5Zm0 0v16.5m12-14.25A2.25 2.25 0 1 0 18 10.5a2.25 2.25 0 0 0 0-4.5Zm0 0A7.5 7.5 0 0 1 10.5 13.5H6",
    mcp: "M12 3.75a2.25 2.25 0 0 0-2.25 2.25v1.5H8.25a2.25 2.25 0 1 0 0 4.5h1.5v1.5a2.25 2.25 0 1 0 4.5 0v-1.5h1.5a2.25 2.25 0 1 0 0-4.5h-1.5V6A2.25 2.25 0 0 0 12 3.75ZM6 12v2.25a2.25 2.25 0 0 0 2.25 2.25H10.5v1.5a2.25 2.25 0 1 0 4.5 0v-1.5h1.5A2.25 2.25 0 0 0 18.75 14.25V12",
    prompt: "M8.25 6.75h7.5m-7.5 3h7.5m-7.5 3H12m-5.25 7.5H17.25A2.25 2.25 0 0 0 19.5 18V6A2.25 2.25 0 0 0 17.25 3.75H6.75A2.25 2.25 0 0 0 4.5 6v12A2.25 2.25 0 0 0 6.75 20.25Z",
    skills: "M12 3.75a2.25 2.25 0 0 0-2.25 2.25v1.5H8.25a2.25 2.25 0 1 0 0 4.5h1.5v1.5a2.25 2.25 0 1 0 4.5 0v-1.5h1.5a2.25 2.25 0 1 0 0-4.5h-1.5V6A2.25 2.25 0 0 0 12 3.75Z M5.25 14.25v3A2.25 2.25 0 0 0 7.5 19.5h9a2.25 2.25 0 0 0 2.25-2.25v-3",
  };
  return <svg className="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
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
  const projectPrompt = useStore((s) => s.prompt);
  const editFile = useStore((s) => s.editFile);
  const [activeSection, setActiveSection] = useState<"ai" | "databases" | "deployment" | "git" | "mcp" | "prompt" | "skills">("ai");
  const [backendStatus, setBackendStatus] = useState<string>("");
  const [localAiEnabled, setLocalAiEnabled] = useState(() => { try { return localStorage.getItem("blitzbot.browser-ai.enabled") === "true"; } catch { return false; } });
  const [localModel, setLocalModel] = useState(() => { try { const saved = localStorage.getItem("blitzbot.browser-ai.model"); const allowed = ["onnx-community/Qwen2.5-Coder-0.5B-Instruct", "onnx-community/Qwen2.5-Coder-1.5B-Instruct"]; const model = saved === "onnx-community/Qwen2.5-Coder-3B-Instruct" ? "onnx-community/Qwen2.5-Coder-1.5B-Instruct" : saved && allowed.includes(saved) ? saved : "onnx-community/Qwen2.5-Coder-0.5B-Instruct"; if (model !== saved) localStorage.setItem("blitzbot.browser-ai.model", model); return model; } catch { return "onnx-community/Qwen2.5-Coder-0.5B-Instruct"; } });
  const [browserDownloadStatus, setBrowserDownloadStatus] = useState("");
  const [browserDownloadProgress, setBrowserDownloadProgress] = useState(0);
  const [browserDownloadBusy, setBrowserDownloadBusy] = useState(false);
  const [backendBusy, setBackendBusy] = useState(false);
  const [deployName, setDeployName] = useState("");
  const [mcpStatus, setMcpStatus] = useState("");
  const [basePrompt, setBasePrompt] = useState(() => { try { return localStorage.getItem("blitzbot.base-prompt.v1") ?? ""; } catch { return ""; } });
  const [skills, setSkills] = useState<{ id: string; name: string; content: string; enabled: boolean }[]>(() => {
    try { return JSON.parse(localStorage.getItem("blitzbot.skills.v1") ?? "[]"); } catch { return []; }
  });
  const [integrationSettings, setIntegrationSettings] = useState<Record<string, string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("blitzbot.integrations.v1") ?? "{}") as Record<string, string>;
      delete stored.mongoUri;
      return stored;
    } catch { return {}; }
  });
  const [settingsNotice, setSettingsNotice] = useState("");
  const [mcpTools, setMcpTools] = useState<McpTool[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("blitzbot.integrations.v1") ?? "{}") as Record<string, string>;
      return JSON.parse(stored.mcpTools ?? "[]") as McpTool[];
    } catch { return []; }
  });
  function saveIntegrationSettings(next: Record<string, string>) {
    setIntegrationSettings(next);
    try { localStorage.setItem("blitzbot.integrations.v1", JSON.stringify(next)); } catch {}
    window.dispatchEvent(new Event("blitzbot-integrations-updated"));
  }
  async function downloadBrowserModel() {
    setBrowserDownloadBusy(true);
    setBrowserDownloadProgress(0);
    setBrowserDownloadStatus("Preparing browser model download…");
    try {
      const { prepareBrowserLocalModel } = await import("../lib/providers");
      await prepareBrowserLocalModel(localModel, (event) => {
        if (typeof event.progress === "number" && Number.isFinite(event.progress)) {
          setBrowserDownloadProgress(Math.max(0, Math.min(100, Math.round(event.progress))));
        }
        const file = event.file ? String(event.file).split("/").pop() : "";
        if (event.status === "download") setBrowserDownloadStatus(file ? "Downloading " + file + "…" : "Downloading model files…");
        else if (event.status === "progress") setBrowserDownloadStatus(file ? "Downloading " + file + "…" : "Downloading model files…");
        else if (event.status === "initiate") setBrowserDownloadStatus(file ? "Starting download of " + file + "…" : "Starting download…");
        else if (event.status === "done") setBrowserDownloadStatus(file ? "Downloaded " + file : "Download complete; preparing model…");
      });
      setBrowserDownloadProgress(100);
      setBrowserDownloadStatus("Model downloaded and ready to use in this browser.");
    } catch (error) {
      setBrowserDownloadStatus("Download failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBrowserDownloadBusy(false);
    }
  }

  async function connectCustomMcp() {
    const endpoint = (integrationSettings.mcpUrl ?? "").trim();
    const token = (integrationSettings.mcpToken ?? "").trim();
    if (!endpoint) { setMcpStatus("Enter the MCP server HTTP endpoint first."); return; }
    setBackendBusy(true);
    setMcpStatus("Connecting and discovering tools…");
    try {
      const connected = await connectMcp(endpoint, token);
      setMcpTools(connected.tools);
      saveIntegrationSettings({
        ...integrationSettings,
        mcpUrl: endpoint,
        mcpSessionId: connected.sessionId,
        mcpTools: JSON.stringify(connected.tools),
        mcpServerInfo: JSON.stringify(connected.serverInfo),
      });
      setMcpStatus("Connected. Found " + connected.tools.length + " tool(s).");
    } catch (error) {
      setMcpStatus("MCP connection failed: " + (error instanceof Error ? error.message : String(error)) + ". The endpoint must support MCP Streamable HTTP and allow browser CORS.");
    } finally { setBackendBusy(false); }
  }
  async function deployCurrentProject(kind: "vercel" | "netlify") {
    const token = (integrationSettings[kind + "Token"] ?? "").trim();
    if (!token) { setSettingsNotice("Add your " + (kind === "vercel" ? "Vercel" : "Netlify") + " token in Deployment first."); return; }
    if (!Object.keys(files).length) { setSettingsNotice("Create or open a project before deploying."); return; }
    setBackendBusy(true);
    setSettingsNotice("Building the current project…");
    try {
      const assets = await buildProjectAssets(files, (line) => setSettingsNotice(line.trim().slice(-240)));
      const name = deployName.trim() || projectPrompt || "blitzbot-project";
      const result = kind === "vercel"
        ? await deployToVercel(assets, token, name, (line) => setSettingsNotice(line))
        : await deployToNetlify(assets, token, name, integrationSettings.netlifySiteId ?? "", (line) => setSettingsNotice(line));
      if (kind === "netlify" && result.id && result.id !== integrationSettings.netlifySiteId) {
        saveIntegrationSettings({ ...integrationSettings, netlifySiteId: result.id });
      }
      setSettingsNotice((kind === "vercel" ? "Vercel" : "Netlify") + " deployment submitted (" + (result.state ?? "status pending") + "): " + result.url);
    } catch (error) {
      setSettingsNotice((kind === "vercel" ? "Vercel" : "Netlify") + " deployment failed: " + (error instanceof Error ? error.message : String(error)));
    } finally { setBackendBusy(false); }
  }
  async function publishToGitLab() {
    const token = (integrationSettings.gitlabToken ?? "").trim();
    if (!token) { setSettingsNotice("Enter a GitLab token with API access first."); return; }
    if (!Object.keys(files).length) { setSettingsNotice("Create or open a project first."); return; }
    const name = (deployName.trim() || projectPrompt || "blitzbot-project").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "blitzbot-project";
    setBackendBusy(true);
    setSettingsNotice("Creating a private GitLab repository…");
    try {
      const createdResponse = await fetch("https://gitlab.com/api/v4/projects", {
        method: "POST",
        headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, visibility: "private", initialize_with_readme: true }),
      });
      const project = await createdResponse.json().catch(() => ({})) as { id?: number; name?: string; web_url?: string; default_branch?: string; message?: string };
      if (!createdResponse.ok || !project.id) throw new Error(project.message || "Could not create a repository (HTTP " + createdResponse.status + ").");
      const actions = Object.entries(files)
        .filter(([filePath]) => !filePath.startsWith("/") && !filePath.split("/").includes(".."))
        .map(([filePath, content]) => ({
          action: filePath.toLowerCase() === "readme.md" ? "update" : "create",
          file_path: filePath,
          content,
        }));
      if (actions.length > 100) throw new Error("This project has more than 100 files. Split the initial upload before publishing to GitLab.");
      const commitResponse = await fetch("https://gitlab.com/api/v4/projects/" + project.id + "/repository/commits", {
        method: "POST",
        headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          branch: project.default_branch || "main",
          commit_message: "Publish project from BlitzBot",
          actions,
        }),
      });
      const commit = await commitResponse.json().catch(() => ({})) as { message?: string; id?: string };
      if (!commitResponse.ok) throw new Error("Repository was created, but the initial file commit failed: " + (commit.message || "HTTP " + commitResponse.status) + ". Repo: " + (project.web_url || project.name));
      setSettingsNotice("Published " + actions.length + " file(s) to GitLab: " + (project.web_url || project.name) + ".");
    } catch (error) {
      setSettingsNotice("GitLab publish failed: " + (error instanceof Error ? error.message : String(error)) + ". Check API token scope and browser CORS.");
    } finally { setBackendBusy(false); }
  }

  async function testGitLab() {
    const token = (integrationSettings.gitlabToken ?? "").trim();
    if (!token) { setSettingsNotice("Enter a GitLab personal access token first."); return; }
    setBackendBusy(true);
    try {
      const response = await fetch("https://gitlab.com/api/v4/user", { headers: { "PRIVATE-TOKEN": token } });
      const data = await response.json().catch(() => ({})) as { username?: string; message?: string };
      if (!response.ok) throw new Error(data.message || "HTTP " + response.status);
      setSettingsNotice("GitLab connected as @" + (data.username ?? "user") + ".");
    } catch (error) {
      setSettingsNotice("GitLab connection failed: " + (error instanceof Error ? error.message : String(error)) + ". Check token scope and browser CORS.");
    } finally { setBackendBusy(false); }
  }
  async function testDeployment(kind: "vercel" | "netlify") {
    const token = integrationSettings[kind + "Token"]?.trim();
    if (!token) { setSettingsNotice("Enter a " + (kind === "vercel" ? "Vercel" : "Netlify") + " access token first."); return; }
    setBackendBusy(true);
    setSettingsNotice("Checking " + (kind === "vercel" ? "Vercel" : "Netlify") + " credentials…");
    try {
      const url = kind === "vercel" ? "https://api.vercel.com/v2/user" : "https://api.netlify.com/api/v1/user";
      const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!response.ok) throw new Error("HTTP " + response.status + ". Check the token and its permissions.");
      const data = await response.json() as { user?: { username?: string }; full_name?: string; email?: string };
      const account = data.user?.username ?? data.full_name ?? data.email ?? "account";
      setSettingsNotice((kind === "vercel" ? "Vercel" : "Netlify") + " credentials verified for " + account + ".");
    } catch (error) {
      setSettingsNotice((kind === "vercel" ? "Vercel" : "Netlify") + " connection failed: " + (error instanceof Error ? error.message : String(error)));
    } finally { setBackendBusy(false); }
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
  const groups = manualGroups(keys, models).filter((group) => localAiEnabled || group.provider !== "web-local");
  const ollamaList = models.ollama ?? [];
  const openrouterList = models.openrouter ?? [];
  const isPicked = (provider: ProviderId, model: string) =>
    compareModels.some((c) => c.provider === provider && c.model === model);

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal modal-settings-fullscreen" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="quiet-link as-button" onClick={() => setOpen(false)}>
            close
          </button>
        </div>

        <p className="trust-note">Configure AI, databases, deployment, Git, MCP, reusable base instructions, and uploaded skills. Browser-only credentials are stored locally; never expose server-only secrets such as Supabase service-role keys.</p>
        <div className="settings-layout">
          <nav className="settings-section-nav" aria-label="Settings sections">
            <span className="settings-nav-label">SETTINGS AREAS</span>
            <button type="button" className={activeSection === "ai" ? "active" : ""} aria-current={activeSection === "ai" ? "page" : undefined} onClick={() => setActiveSection("ai")}><SettingsIcon name="cpu" /> AI &amp; models</button>
            <button type="button" className={activeSection === "databases" ? "active" : ""} aria-current={activeSection === "databases" ? "page" : undefined} onClick={() => setActiveSection("databases")}><SettingsIcon name="database" /> Databases</button>
            <button type="button" className={activeSection === "deployment" ? "active" : ""} aria-current={activeSection === "deployment" ? "page" : undefined} onClick={() => setActiveSection("deployment")}><SettingsIcon name="deploy" /> Deployment</button>
            <button type="button" className={activeSection === "git" ? "active" : ""} aria-current={activeSection === "git" ? "page" : undefined} onClick={() => setActiveSection("git")}><SettingsIcon name="git" /> GitHub &amp; GitLab</button>
            <button type="button" className={activeSection === "mcp" ? "active" : ""} aria-current={activeSection === "mcp" ? "page" : undefined} onClick={() => setActiveSection("mcp")}><SettingsIcon name="mcp" /> Custom MCP</button>
            <button type="button" className={activeSection === "prompt" ? "active" : ""} aria-current={activeSection === "prompt" ? "page" : undefined} onClick={() => setActiveSection("prompt")}><SettingsIcon name="prompt" /> Base prompt</button>
            <button type="button" className={activeSection === "skills" ? "active" : ""} aria-current={activeSection === "skills" ? "page" : undefined} onClick={() => setActiveSection("skills")}><SettingsIcon name="skills" /> Skills</button>
          </nav>
          <div className="settings-content">
        {error && <p className="modal-error">{error}</p>}
        {activeSection === "ai" && <>
        <section id="settings-ai" className="browser-ai-settings settings-section"><h3><SettingsIcon name="cpu" /> Browser-local AI</h3>
          <div className="field-row"><span className="field-label-strong">Browser-local coding AI (optional)</span></div>
          <p className="field-hint">Runs in this browser with no personal API key. Model weights download only when first enabled and used. First load may take a while and needs storage and available memory.</p>
          <label className="check"><input type="checkbox" checked={localAiEnabled} onChange={(e) => {
            const enabled = e.target.checked; setLocalAiEnabled(enabled);
            try { localStorage.setItem("blitzbot.browser-ai.enabled", String(enabled)); } catch {}
            window.dispatchEvent(new Event("blitzbot-integrations-updated"));
            if (enabled) setPref({ autoRoute: false, manualChoice: { provider: "web-local", model: localModel } });
            else { setPref({ autoRoute: true, manualChoice: null }); void import("../lib/providers").then((m) => m.unloadBrowserLocalModel()); }
          }} /><span>Enable browser-local AI as my selected provider</span></label>
          <label className="field"><span>Model size</span><select value={localModel} onChange={(e) => {
            const model = e.target.value; setLocalModel(model);
            try { localStorage.setItem("blitzbot.browser-ai.model", model); } catch {}
            if (localAiEnabled) setPref({ autoRoute: false, manualChoice: { provider: "web-local", model } });
          }}><option value="onnx-community/Qwen2.5-Coder-0.5B-Instruct">Small · best compatibility (recommended)</option><option value="onnx-community/Qwen2.5-Coder-1.5B-Instruct">Medium · needs more memory</option></select></label>
          <div className="browser-model-download">
            <button type="button" className="primary-button" disabled={browserDownloadBusy} onClick={() => void downloadBrowserModel()}>{browserDownloadBusy ? "Downloading model…" : "Download browser model"}</button>
            {browserDownloadBusy && <progress className="browser-model-progress" max={100} value={browserDownloadProgress} aria-label="Browser model download progress" />}
            {browserDownloadStatus && <p className="field-hint" role="status">{browserDownloadStatus}{browserDownloadBusy && browserDownloadProgress > 0 ? " (" + browserDownloadProgress + "%)" : ""}</p>}
          </div>
          <p className="field-hint">This provider is only selected when you enable it. Turn it off to return to automatic routing. Device compatibility and memory use vary.</p>
        </section>

        <section id="settings-ai-providers" className="settings-section">
          <h3><SettingsIcon name="cpu" /> Cloud AI & model routing</h3>
          <p className="field-hint">Connect hosted models or your own local API. Only the selected provider is used for a request.</p>
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
              onChange={(e) => {
                const enabled = e.target.checked;
                setPref({ autoRoute: enabled, ...(enabled && manualChoice?.provider === "web-local" ? { manualChoice: null } : {}) });
                if (enabled && localAiEnabled) {
                  setLocalAiEnabled(false);
                  try { localStorage.setItem("blitzbot.browser-ai.enabled", "false"); } catch {}
                  window.dispatchEvent(new Event("blitzbot-integrations-updated"));
                  void import("../lib/providers").then((m) => m.unloadBrowserLocalModel());
                }
              }}
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
                if (provider && model) {
                  setPref({ autoRoute: false, manualChoice: { provider, model } });
                  const useLocal = provider === "web-local";
                  if (useLocal !== localAiEnabled) {
                    setLocalAiEnabled(useLocal);
                    try { localStorage.setItem("blitzbot.browser-ai.enabled", String(useLocal)); } catch {}
                    window.dispatchEvent(new Event("blitzbot-integrations-updated"));
                    if (!useLocal) void import("../lib/providers").then((m) => m.unloadBrowserLocalModel());
                  }
                }
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
        
        </section>
        <div className="field-row settings-readme-option">
          <label className="check">
            <input type="checkbox" checked={autoReadme} onChange={(e) => setPref({ autoReadme: e.target.checked })} />
            <span>Write a README.md after each build</span>
          </label>
        </div>
        </>}

        {activeSection === "databases" && <section id="settings-databases" className="settings-section">
          <h3><SettingsIcon name="database" /> Databases & backends</h3>
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
        <label className="field"><span>MongoDB API/proxy URL</span><input value={integrationSettings.mongoProxyUrl ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, mongoProxyUrl: e.target.value })} placeholder="https://your-secure-api.example.com" /></label>
        <p className="field-hint">MongoDB connection strings and database passwords belong in your server's environment variables. Connect through your own authenticated API; never put database admin credentials in browser storage.</p>
        <label className="field"><span>rqlite API URL</span><input value={integrationSettings.rqliteUrl ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, rqliteUrl: e.target.value })} placeholder="http://localhost:4001" /></label>
        <label className="field"><span>PocketBase URL</span><input value={integrationSettings.pocketbaseUrl ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, pocketbaseUrl: e.target.value })} placeholder="https://your-instance.example.com" /></label>
        <label className="field"><span>Custom database API / secure proxy URL</span><input value={integrationSettings.databaseApiUrl ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, databaseApiUrl: e.target.value })} placeholder="https://your-api.example.com" /></label>
        <label className="field"><span>Optional user-scoped API bearer token</span><input type="password" value={integrationSettings.databaseApiToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, databaseApiToken: e.target.value })} placeholder="User/session access token only" autoComplete="off" /></label>
        <p className="field-hint">Use your own authenticated API or serverless functions for privileged writes. Keep Supabase service-role keys, MongoDB URIs, Appwrite server API keys and other admin credentials in that server's environment-secret store, never in BlitzBot or generated client code. Provide a GET /health endpoint to test the connection.</p>
        </section>}

        {activeSection === "deployment" && <section id="settings-deployment" className="settings-section">
          <h3><SettingsIcon name="deploy" /> Deployment</h3>
          <p className="field-hint">Builds the current generated project in your browser and uploads the production assets. Review the host's dashboard after the upload. Tokens are stored locally in this browser.</p>
          <label className="field"><span>Project / site name (optional)</span><input value={deployName} onChange={(e) => setDeployName(e.target.value)} placeholder="Use the project prompt by default" /></label>
          <label className="field"><span>Vercel access token</span><input type="password" value={integrationSettings.vercelToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, vercelToken: e.target.value })} placeholder="Vercel token" autoComplete="off" /></label>
          <label className="field"><span>Netlify access token</span><input type="password" value={integrationSettings.netlifyToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, netlifyToken: e.target.value })} placeholder="Netlify token" autoComplete="off" /></label>
          <label className="field"><span>Netlify site ID (optional; saved automatically after the first deploy)</span><input value={integrationSettings.netlifySiteId ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, netlifySiteId: e.target.value.trim() })} placeholder="Existing site's ID" autoComplete="off" /></label>
          <div className="settings-inline-actions">
            <button className="quiet-link as-button" disabled={backendBusy} onClick={() => void testDeployment("vercel")}>Test Vercel connection</button>
            <button className="quiet-link as-button" disabled={backendBusy} onClick={() => void testDeployment("netlify")}>Test Netlify connection</button>
          </div>
          <div className="settings-inline-actions">
            <button className="btn-primary btn-sm" disabled={backendBusy || !Object.keys(files).length} onClick={() => void deployCurrentProject("vercel")}>{backendBusy ? "Working…" : "Build & deploy to Vercel"}</button>
            <button className="btn-primary btn-sm" disabled={backendBusy || !Object.keys(files).length} onClick={() => void deployCurrentProject("netlify")}>{backendBusy ? "Working…" : "Build & deploy to Netlify"}</button>
          </div>
          {settingsNotice && <p className="field-hint deployment-status">{settingsNotice}</p>}
        </section>}
        {activeSection === "git" && <section id="settings-git" className="settings-section">
          <h3><SettingsIcon name="git" /> GitHub & GitLab</h3>
          <p className="field-hint">GitHub repository import and publishing are available through the GitHub token and Ship to GitHub workflow. This section verifies GitLab credentials.</p>
          <label className="field">
            <span>GitHub personal access token (push / PRs / private imports)</span>
            <input type="password" value={keys.github} onChange={(e) => setKeys({ github: e.target.value.trim() })} placeholder="github_pat_… or ghp_…" autoComplete="off" />
          </label>
          <p className="field-hint">Needs repository access. Fine-grained tokens should grant Contents read/write and Pull requests read/write only for repositories you intend to use.</p>
          <label className="field"><span>GitLab personal access token</span><input type="password" value={integrationSettings.gitlabToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, gitlabToken: e.target.value })} placeholder="glpat-…" autoComplete="off" /></label>
          <div className="settings-inline-actions"><button className="quiet-link as-button" disabled={backendBusy} onClick={() => void testGitLab()}>Test GitLab connection</button></div>
          <div className="settings-inline-actions"><button className="btn-primary btn-sm" disabled={backendBusy || !Object.keys(files).length} onClick={() => void publishToGitLab()}>{backendBusy ? "Working…" : "Publish current project to new private GitLab repo"}</button></div>
          {settingsNotice && <p className="field-hint">{settingsNotice}</p>}
        </section>}
        {activeSection === "mcp" && <section id="settings-mcp" className="settings-section">
          <h3><SettingsIcon name="mcp" /> Custom MCP</h3>
          <p className="field-hint">Connect an MCP Streamable HTTP endpoint that permits browser CORS. Only connect servers you trust; tools can read or change external data.</p>
          <label className="field"><span>MCP server endpoint</span><input value={integrationSettings.mcpUrl ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, mcpUrl: e.target.value })} placeholder="https://your-mcp-server.example.com/mcp" /></label>
          <label className="field"><span>Optional bearer token</span><input type="password" value={integrationSettings.mcpToken ?? ""} onChange={(e) => saveIntegrationSettings({ ...integrationSettings, mcpToken: e.target.value })} placeholder="MCP access token" autoComplete="off" /></label>
          <div className="settings-inline-actions">
            <button className="btn-primary btn-sm" disabled={backendBusy} onClick={() => void connectCustomMcp()}>{backendBusy ? "Connecting…" : "Connect & discover tools"}</button>
            <button className="quiet-link as-button" onClick={() => { setMcpTools([]); saveIntegrationSettings({ ...integrationSettings, mcpTools: "[]", mcpSessionId: "" }); setMcpStatus("Cleared the saved tool list."); }}>Clear tool list</button>
          </div>
          {mcpStatus && <p className="field-hint">{mcpStatus}</p>}
          {mcpTools.length > 0 && <ul className="mcp-tool-list">{mcpTools.map((tool) => <li key={tool.name}><strong>{tool.name}</strong>{tool.description ? <span> — {tool.description}</span> : null}</li>)}</ul>}
        </section>}
        {activeSection === "prompt" && <section id="settings-base-prompt" className="settings-section">
          <h3><SettingsIcon name="prompt" /> Base prompt</h3>
          <p className="field-hint">Persistent instructions appended to the built-in prompt for future coding and ideation requests.</p>
          <label className="field"><span>Your instructions</span><textarea rows={6} value={basePrompt} onChange={(e) => { setBasePrompt(e.target.value); try { localStorage.setItem("blitzbot.base-prompt.v1", e.target.value); } catch {} }} placeholder="Prefer accessible React components, TypeScript, and minimal dependencies…" /></label>
        </section>}
        {activeSection === "skills" && <section id="settings-skills" className="settings-section">
          <h3><SettingsIcon name="skills" /> Skills</h3>
          <p className="field-hint">Upload .md, .txt, or .json instructions (under 100 KB each). Enabled skills are included in future model context and stored in this browser.</p>
          <label className="field"><span>Upload skill files</span><input type="file" accept=".md,.txt,.json,text/plain,text/markdown,application/json" multiple onChange={(e) => { void importSkills(e.target.files); e.currentTarget.value = ""; }} /></label>
          {skills.map((skill) => <div className="skill-row" key={skill.id}>
            <label className="check"><input type="checkbox" checked={skill.enabled} onChange={(e) => setSkills((current) => { const next = current.map((s) => s.id === skill.id ? { ...s, enabled: e.target.checked } : s); try { localStorage.setItem("blitzbot.skills.v1", JSON.stringify(next)); } catch {} return next; })} /><span>{skill.name}</span></label>
            <button className="quiet-link as-button" onClick={() => setSkills((current) => { const next = current.filter((s) => s.id !== skill.id); try { localStorage.setItem("blitzbot.skills.v1", JSON.stringify(next)); } catch {} return next; })}>Remove</button>
          </div>)}
          {settingsNotice && <p className="field-hint">{settingsNotice}</p>}
        </section>}

          </div>
        </div>
      </div>
    </div>
  );
}
