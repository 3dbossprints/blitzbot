import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { ChatEntry } from "../lib/store";
import { fmtUsd } from "../lib/pricing";
import type { FileChange } from "../lib/types";
import { callMcpTool, type McpTool } from "../lib/mcp";

function Receipt({ entry }: { entry: ChatEntry }) {
  const r = entry.receipt;
  if (!r) return null;
  return (
    <div
      className="receipt"
      title={r.usage.estimated ? "token counts estimated" : "token counts reported by provider"}
    >
      <span>{r.model}</span>
      <span>
        {r.usage.inputTokens.toLocaleString()} in · {r.usage.outputTokens.toLocaleString()} out
        {r.usage.estimated ? " (est)" : ""}
      </span>
      <span>{fmtUsd(r.costUsd)}</span>
      <span>{(r.durationMs / 1000).toFixed(1)}s</span>
      {r.fileCount > 0 && <span>{r.fileCount} files</span>}
    </div>
  );
}

function Diffs({ changes }: { changes: FileChange[] }) {
  const real = changes.filter((c) => c.added + c.removed > 0 || c.isNew);
  if (real.length === 0) return null;
  const totalAdd = real.reduce((n, c) => n + c.added, 0);
  const totalDel = real.reduce((n, c) => n + c.removed, 0);
  return (
    <details className="diffs">
      <summary>
        {real.length} file{real.length > 1 ? "s" : ""} changed{" "}
        <span className="diff-add">+{totalAdd}</span> <span className="diff-del">−{totalDel}</span>
      </summary>
      {real.map((c) => (
        <details key={c.path} className="diff-file">
          <summary className="mono">
            {c.path} {c.isNew && <span className="diff-new">new</span>}{" "}
            <span className="diff-add">+{c.added}</span> <span className="diff-del">−{c.removed}</span>
          </summary>
          {c.lines ? (
            <pre className="diff-body mono">
              {c.lines.map((l, i) => (
                <div key={i} className={`dl dl-${l.t}`}>
                  {l.t === "add" ? "+ " : l.t === "del" ? "− " : "  "}
                  {l.s}
                </div>
              ))}
            </pre>
          ) : (
            <p className="diff-note">{c.isNew ? "new file" : "diff too large to render — counts only"}</p>
          )}
        </details>
      ))}
    </details>
  );
}

export function ChatPane({ ideateOnly = false }: { ideateOnly?: boolean }) {
  const chat = useStore((s) => s.chat);
  const keys = useStore((s) => s.keys);
  const writingFile = useStore((s) => s.writingFile);
  const buildBusy = useStore((s) => s.buildBusy);
  const mode = useStore((s) => s.mode);
  const setPref = useStore((s) => s.setPref);
  const compareOn = useStore((s) => s.compareOn);
  const compareModels = useStore((s) => s.compareModels);
  const dispatch = useStore((s) => s.dispatch);
  const removeChatEntry = useStore((s) => s.removeChatEntry);
  const restoreCheckpoint = useStore((s) => s.restoreCheckpoint);
  const checkpoints = useStore((s) => s.checkpoints);
  const [value, setValue] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachedConnections, setAttachedConnections] = useState<string[]>([]);
  const [toolResults, setToolResults] = useState<string[]>([]);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState("");
  const [integrationSettings, setIntegrationSettings] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("blitzbot.integrations.v1") ?? "{}"); } catch { return {}; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, writingFile]);

  useEffect(() => {
    const refresh = () => {
      try { setIntegrationSettings(JSON.parse(localStorage.getItem("blitzbot.integrations.v1") ?? "{}")); } catch { setIntegrationSettings({}); }
    };
    window.addEventListener("blitzbot-integrations-updated", refresh);
    return () => window.removeEventListener("blitzbot-integrations-updated", refresh);
  }, []);

  const compareReady = compareModels.length >= 2;

  const resources: { id: string; label: string; detail: string; prompt: string }[] = [];
  if (keys.supabaseUrl && keys.supabaseKey) resources.push({
    id: "supabase", label: "Supabase", detail: "Browser-safe project credentials configured",
    prompt: "Use the configured Supabase integration via VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Apply Row Level Security, do not hardcode credentials, and keep service-role keys on the server."
  });
  if (keys.appwriteEndpoint && keys.appwriteProjectId) resources.push({
    id: "appwrite", label: "Appwrite", detail: "Endpoint and project ID configured",
    prompt: "Use the configured Appwrite endpoint and project ID with the official Web SDK. Respect collection permissions; never embed server API keys."
  });
  if (integrationSettings.pocketbaseUrl) resources.push({
    id: "pocketbase", label: "PocketBase", detail: integrationSettings.pocketbaseUrl,
    prompt: "Use the configured PocketBase URL with real SDK or REST calls. Include authentication, loading, empty and error states; do not fake writes."
  });
  if (integrationSettings.rqliteUrl) resources.push({
    id: "rqlite", label: "rqlite", detail: integrationSettings.rqliteUrl,
    prompt: "Use the configured rqlite API endpoint through a deliberately CORS-enabled connection or server API. Never expose database admin credentials in frontend code."
  });
  if (integrationSettings.mongoProxyUrl) resources.push({
    id: "mongodb", label: "MongoDB API", detail: integrationSettings.mongoProxyUrl,
    prompt: "Use the configured authenticated MongoDB proxy URL. MongoDB URI and credentials must remain in server environment variables, never client code."
  });
  if (keys.github) resources.push({
    id: "github", label: "GitHub", detail: "GitHub token configured",
    prompt: "GitHub integration is configured. Never include its token in source, prompts, or logs. Use the Ship to GitHub action for publishing and confirm before changing remote branches."
  });
  if (integrationSettings.gitlabToken) resources.push({
    id: "gitlab", label: "GitLab", detail: "GitLab token configured",
    prompt: "GitLab credentials are configured. Never reveal or embed the token. Use the GitLab API for repository operations and confirm before publishing."
  });

  const mcpTools = (() => {
    try { return JSON.parse(integrationSettings.mcpTools ?? "[]") as McpTool[]; } catch { return []; }
  })();

  async function runMcpTool(tool: McpTool) {
    const endpoint = (integrationSettings.mcpUrl ?? "").trim();
    if (!endpoint) { setToolStatus("Connect an MCP server in Settings first."); return; }
    const raw = window.prompt("Arguments for " + tool.name + " (JSON object)", "{}");
    if (raw === null) return;
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Arguments must be a JSON object.");
      args = parsed as Record<string, unknown>;
    } catch (error) {
      setToolStatus("Invalid tool arguments: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
    setToolBusy(tool.name);
    setToolStatus("Running MCP tool " + tool.name + "…");
    try {
      const result = await callMcpTool(
        endpoint,
        integrationSettings.mcpToken ?? "",
        integrationSettings.mcpSessionId ?? "",
        tool.name,
        args,
      );
      const rendered = JSON.stringify(result, null, 2) ?? String(result);
      setToolResults((items) => [...items, "Tool: " + tool.name + "\nArguments: " + JSON.stringify(args) + "\nResult:\n" + rendered]);
      setToolStatus("Tool result added to the context for your next message.");
      setPlusOpen(false);
    } catch (error) {
      setToolStatus("MCP tool failed: " + (error instanceof Error ? error.message : String(error)));
    } finally { setToolBusy(null); }
  }

  function send() {
    const p = value.trim();
    if (!p) return;
    const selected = resources.filter((resource) => attachedConnections.includes(resource.id));
    const connectionContext = selected.length
      ? "CONNECTED SERVICE CONTEXT (do not reveal credentials; use real integrations and preserve security):\n" + selected.map((resource) => "- " + resource.label + ": " + resource.prompt).join("\n")
      : "";
    const mcpContext = toolResults.length ? "MCP TOOL RESULTS FROM USER-REQUESTED ACTIONS:\n" + toolResults.join("\n\n") : "";
    const enriched = [connectionContext, mcpContext, "USER REQUEST:\n" + p].filter(Boolean).join("\n\n");
    setValue("");
    setToolResults([]);
    dispatch(enriched);
  }

  return (
    <section className="pane chat-pane" aria-label="Chat">
      <div className="pane-head">Conversation</div>
      <div className="chat-scroll" ref={scrollRef}>
        {chat.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role msg-role-row">
              <span>{m.role === "user" ? "you" : "BlitzBot"}{m.mode === "ideate" && <span className="mode-tag"> · ideate</span>}</span>
              <button className="message-delete as-button" title="Delete this message" aria-label="Delete this message" onClick={() => {
                if (window.confirm("Delete this message from the saved conversation?")) removeChatEntry(m.id);
              }}>×</button>
            </div>
            <div className="msg-body">
              {m.content ||
                (m.role === "assistant" && m.status === "streaming" ? "…" : "")}
            </div>
            {m.status === "queued" && (
              <div className="queue-pill">queued — runs after the current build</div>
            )}
            {(m.status === "error" || m.status === "aborted") && m.error && (
              <div className={`msg-note ${m.status === "aborted" ? "note-abort" : "note-error"}`}>
                {m.error}
              </div>
            )}
            {m.changes && m.changes.length > 0 && <Diffs changes={m.changes} />}
            <Receipt entry={m} />
            {m.checkpointId && checkpoints.some((c) => c.id === m.checkpointId) && (
              <button
                className="restore-btn as-button"
                onClick={() => {
                  if (window.confirm("Restore project files to this checkpoint?"))
                    void restoreCheckpoint(m.checkpointId!);
                }}
              >
                restore this version
              </button>
            )}
          </div>
        ))}
        {writingFile && <div className="writing-pill">writing {writingFile}…</div>}
      </div>
      <div className="chat-controls">
        {!ideateOnly && <div className="mode-seg" role="radiogroup" aria-label="Message mode">
          <button
            className={`mode-btn ${mode === "build" ? "on" : ""}`}
            onClick={() => setPref({ mode: "build" })}
          >
            Build
          </button>
          <button
            className={`mode-btn ${mode === "ideate" ? "on" : ""}`}
            onClick={() => setPref({ mode: "ideate" })}
          >
            Ideate
          </button>
        </div>}
        {!ideateOnly && mode === "build" && (
          <button
            className={`compare-toggle as-button ${compareOn && compareReady ? "on" : ""}`}
            disabled={!compareReady}
            title={
              compareReady
                ? "Run this prompt through your compare candidates and pick a winner"
                : "Pick 2–3 compare candidates in Keys & models"
            }
            onClick={() => setPref({ compareOn: !compareOn })}
          >
            ⇄ compare{compareReady ? ` ${compareModels.length}` : ""}
          </button>
        )}
      </div>
      <div className="chat-input-row">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={
            mode === "ideate"
              ? "ask anything — answers even mid-build…"
              : buildBusy
                ? "describe changes — queues after current build…"
                : "describe changes…"
          }
          aria-label="Message"
        />
        <button onClick={send} disabled={!value.trim()} className="btn-primary btn-sm">
          Send
        </button>
      </div>
    </section>
  );
}
