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


let browserPipeline: any = null;
let browserPipelineId = "";
let browserPipelinePromise: Promise<any> | null = null;
let browserPipelinePendingId = "";
let browserModelGeneration = 0;

/** Release browser model resources when the user turns the feature off. */
export async function unloadBrowserLocalModel() {
  browserModelGeneration++;
  const current = browserPipeline;
  browserPipeline = null;
  browserPipelineId = "";
  browserPipelinePromise = null;
  browserPipelinePendingId = "";
  try { await current?.dispose?.(); } catch { /* already released */ }
}

function describeBrowserModelError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: any = error;
  for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === "string") parts.push(current);
    else {
      if (current.name && current.message) parts.push(`${current.name}: ${current.message}`);
      else if (current.message) parts.push(String(current.message));
      else if (current.name) parts.push(String(current.name));
      else parts.push(String(current));
      if (current.code !== undefined) parts.push(`code=${String(current.code)}`);
      if (current.cause && current.cause !== current) {
        current = current.cause;
        continue;
      }
    }
    break;
  }
  return parts.filter(Boolean).join(" | ") || "Unknown model-loading error. Check Network requests for failed model files.";
}

async function streamBrowserLocal(o: StreamOpts): Promise<Usage> {
  const modelId = o.model || "onnx-community/Qwen2.5-Coder-1.5B-Instruct";
  if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  if (!browserPipeline || browserPipelineId !== modelId) {
    let generation = browserModelGeneration;
    try {
      let pending: Promise<any>;
      if (browserPipelinePromise && browserPipelinePendingId === modelId) {
        pending = browserPipelinePromise;
      } else {
        await unloadBrowserLocalModel();
        generation = browserModelGeneration;
        browserPipelinePendingId = modelId;
        const { pipeline, env } = await import("@huggingface/transformers");
        env.allowLocalModels = false;
        // Keep pipeline creation inside the try block so synchronous setup errors
        // and failed model downloads are both surfaced to the user and log.
        pending = Promise.resolve().then(() => pipeline("text-generation", modelId, { dtype: "q4" }));
        browserPipelinePromise = pending;
      }

      const loaded = await pending;
      if (generation !== browserModelGeneration || (browserPipelinePendingId !== modelId && browserPipelineId !== modelId)) {
        try { await loaded.dispose?.(); } catch { /* stale model finished loading after it was disabled */ }
        throw new Error("Browser-local AI was switched off or changed while loading.");
      }
      browserPipeline = loaded;
      browserPipelineId = modelId;
      browserPipelinePromise = null;
      browserPipelinePendingId = "";
    } catch (e) {
      if (generation === browserModelGeneration) {
        browserPipelinePromise = null;
        browserPipelinePendingId = "";
      }
      const detail = describeBrowserModelError(e);
      console.error("[BlitzBot browser AI] Model load failed", { modelId, error: detail, cause: e });
      throw new Error("Could not load the browser model. " + detail);
    }
  }

  if (!browserPipeline || browserPipelineId !== modelId) {
    throw new Error("Browser-local AI is not active. Enable it in Settings and try again.");
  }

  const { TextStreamer } = await import("@huggingface/transformers");
  const messages = [{ role: "system", content: o.system }, ...o.messages];
  let full = "";
  const streamer = new TextStreamer(browserPipeline.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (o.signal?.aborted || !chunk) return;
      full += chunk;
      o.onText(chunk);
    },
  });
  const maxTokens = modelId.includes("3B") ? 3072 : 2048;
  const result = await browserPipeline(messages, {
    max_new_tokens: maxTokens,
    do_sample: false,
    streamer,
  });
  if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!full) {
    const generated = result?.[0]?.generated_text;
    if (typeof generated === "string") full = generated;
    else if (Array.isArray(generated)) {
      const last = generated[generated.length - 1];
      if (typeof last?.content === "string") full = last.content;
    }
    if (full) o.onText(full);
  }
  return {
    inputTokens: estimateTokens(o.system + o.messages.map((m) => m.content).join("\n")),
    outputTokens: estimateTokens(full),
    estimated: true,
  };
}
