import type { ChatMsg, Keys, ProviderId, Usage } from "./types";
import { estimateTokens } from "./pricing";

export interface StreamOpts {
  provider: ProviderId;
  model: string;
  system: string;
  messages: ChatMsg[];
  keys: Keys;
  onText: (chunk: string) => void;
  signal?: AbortSignal;
}

/**
 * Streams a chat completion directly from the browser to the provider.
 * No proxy, no backend — the key goes straight to the provider you chose.
 * Returns token usage (real when the provider reports it, estimated otherwise).
 */
export async function streamChat(opts: StreamOpts): Promise<Usage> {
  if (opts.provider === "web-local") return streamBrowserLocal(opts);
  if (opts.provider === "anthropic") return streamAnthropic(opts);
  return streamOpenAICompatible(opts);
}

// ---------------------------------------------------------------- Anthropic

async function streamAnthropic(o: StreamOpts): Promise<Usage> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: o.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": o.keys.anthropic,
      "anthropic-version": "2023-06-01",
      // Anthropic requires this opt-in header for direct browser calls.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: o.model,
      max_tokens: 16000,
      system: o.system,
      messages: o.messages,
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await safeText(res)}`);

  let inTok = 0;
  let outTok = 0;
  let sawUsage = false;
  let outChars = 0;

  await readSse(res, (data) => {
    try {
      const ev = JSON.parse(data);
      if (ev.type === "message_start" && ev.message?.usage) {
        inTok = ev.message.usage.input_tokens ?? 0;
        sawUsage = true;
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        outChars += ev.delta.text.length;
        o.onText(ev.delta.text);
      } else if (ev.type === "message_delta" && ev.usage) {
        outTok = ev.usage.output_tokens ?? outTok;
      } else if (ev.type === "error") {
        throw new Error(ev.error?.message ?? "Anthropic stream error");
      }
    } catch (e) {
      if (e instanceof SyntaxError) return; // ignore non-JSON keepalives
      throw e;
    }
  });

  if (!sawUsage) inTok = estimateTokens(o.system + o.messages.map((m) => m.content).join(""));
  if (!outTok) outTok = estimateTokens("x".repeat(outChars));
  return { inputTokens: inTok, outputTokens: outTok, estimated: !sawUsage };
}

// ------------------------------------------- OpenAI / OpenRouter / Ollama

function endpointFor(o: StreamOpts): { url: string; headers: Record<string, string> } {
  switch (o.provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { authorization: `Bearer ${o.keys.openai}` },
      };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          authorization: `Bearer ${o.keys.openrouter}`,
          "http-referer": location.origin,
          "x-title": "BlitzBot",
        },
      };
    case "ollama": {
      const base = o.keys.ollamaUrl.replace(/\/+$/, "");
      return { url: `${base}/chat/completions`, headers: {} };
    }
    default:
      throw new Error(`Unknown provider ${o.provider}`);
  }
}

async function streamOpenAICompatible(o: StreamOpts): Promise<Usage> {
  const { url, headers } = endpointFor(o);
  const body: Record<string, unknown> = {
    model: o.model,
    stream: true,
    messages: [{ role: "system", content: o.system }, ...o.messages],
  };
  // Ollama's OpenAI-compat layer may reject stream_options; only ask the
  // hosted providers for usage in the final chunk.
  if (o.provider !== "ollama") body.stream_options = { include_usage: true };

  const res = await fetch(url, {
    method: "POST",
    signal: o.signal,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${o.provider} ${res.status}: ${await safeText(res)}`);

  let inTok = 0;
  let outTok = 0;
  let sawUsage = false;
  let outChars = 0;

  await readSse(res, (data) => {
    if (data === "[DONE]") return;
    try {
      const ev = JSON.parse(data);
      const delta = ev.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length) {
        outChars += delta.length;
        o.onText(delta);
      }
      if (ev.usage) {
        inTok = ev.usage.prompt_tokens ?? inTok;
        outTok = ev.usage.completion_tokens ?? outTok;
        sawUsage = true;
      }
    } catch {
      /* ignore malformed keepalive lines */
    }
  });

  if (!sawUsage) {
    inTok = estimateTokens(o.system + o.messages.map((m) => m.content).join(""));
    outTok = estimateTokens("x".repeat(outChars));
  }
  return { inputTokens: inTok, outputTokens: outTok, estimated: !sawUsage };
}

// ------------------------------------------------------------------ shared

async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Response has no body");
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) onData(trimmed.slice(5).trim());
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 400);
  } catch {
    return "(no body)";
  }
}

export function hasAnyKey(keys: Keys): boolean {
  return Boolean(keys.openai || keys.anthropic || keys.openrouter || keys.ollamaUrl);
}



let browserWorker: Worker | null = null;
let browserWorkerRequestId = 0;

type WorkerResponse = {
  id: number;
  type: "progress" | "ready" | "text" | "done" | "error";
  progress?: BrowserModelProgress;
  modelId?: string;
  chunk?: string;
  outputTokensText?: string;
  error?: string;
};

function getBrowserWorker(): Worker {
  if (!browserWorker) {
    browserWorker = new Worker(new URL("./browserModel.worker.ts", import.meta.url), { type: "module" });
  }
  return browserWorker;
}

function workerRequest(
  message: Record<string, unknown>,
  callbacks: { onProgress?: (progress: BrowserModelProgress) => void; onText?: (chunk: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  if (callbacks.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  const worker = getBrowserWorker();
  const id = ++browserWorkerRequestId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      callbacks.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.id !== id) return;
      if (data.type === "progress" && data.progress) callbacks.onProgress?.(data.progress);
      else if (data.type === "text" && data.chunk) callbacks.onText?.(data.chunk);
      else if (data.type === "error") finish(() => reject(new Error(data.error || "Browser model worker failed.")));
      else if (data.type === "done") finish(() => resolve(data.outputTokensText ?? ""));
    };
    worker.addEventListener("message", onMessage);
    callbacks.signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ ...message, id });
  });
}

/** Release browser model resources by terminating its dedicated worker. */
export async function unloadBrowserLocalModel() {
  browserWorker?.terminate();
  browserWorker = null;
}

function describeBrowserModelError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: any = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4 && !seen.has(current); depth++) {
    if (typeof current === "object" || typeof current === "function") seen.add(current);
    if (typeof current === "string" || typeof current === "number" || typeof current === "bigint") {
      parts.push(String(current));
      break;
    }
    if (current.name && current.message) parts.push(String(current.name) + ": " + String(current.message));
    else if (current.message) parts.push(String(current.message));
    else if (current.name) parts.push(String(current.name));
    else if (current.code !== undefined) parts.push("Runtime error code " + String(current.code));
    else {
      try { parts.push(JSON.stringify(current)); } catch { parts.push(String(current)); }
    }
    if (current.code !== undefined && current.message) parts.push("code=" + String(current.code));
    if (current.cause !== undefined && current.cause !== current) { current = current.cause; continue; }
    break;
  }
  const detail = parts.filter(Boolean).join(" | ");
  if (!detail) return "Unknown model-loading error. Check model-file download access and browser compatibility.";
  if (/^\\d+$/.test(detail)) {
    return "The browser AI runtime returned numeric error code " + detail + ". Model loading may have failed during download, WebAssembly/ONNX initialisation, or due to browser memory limits.";
  }
  return detail;
}

export type BrowserModelProgress = { status?: string; file?: string; progress?: number; loaded?: number; total?: number };

export async function prepareBrowserLocalModel(
  modelId: string,
  onProgress?: (progress: BrowserModelProgress) => void,
): Promise<void> {
  try {
    await workerRequest({ type: "load", modelId }, { onProgress });
    onProgress?.({ status: "ready", progress: 100 });
  } catch (error) {
    const detail = describeBrowserModelError(error);
    console.error("[BlitzBot browser AI] Model download/load failed", { modelId, error: detail, cause: error });
    throw new Error(detail);
  }
}

async function streamBrowserLocal(o: StreamOpts): Promise<Usage> {
  const modelId = o.model || "onnx-community/Qwen2.5-Coder-0.5B-Instruct";
  if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let full = "";
  // Keep inference off the UI thread so local model execution cannot freeze the chat interface.
  const maxTokens = modelId.includes("3B") ? 512 : 256;
  try {
    full = await workerRequest({
      type: "generate", modelId, system: o.system, messages: o.messages, maxTokens,
    }, {
      signal: o.signal,
      onText: (chunk) => { if (!o.signal?.aborted && chunk) o.onText(chunk); },
    });
  } catch (error) {
    if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new Error("Browser-local AI failed: " + describeBrowserModelError(error));
  }
  if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return {
    inputTokens: estimateTokens(o.system + o.messages.map((m) => m.content).join("\n")),
    outputTokens: estimateTokens(full),
    estimated: true,
  };
}
