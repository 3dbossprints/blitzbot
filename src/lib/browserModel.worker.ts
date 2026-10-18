import { pipeline, env, TextStreamer } from "@huggingface/transformers";

type RequestMessage =
  | { id: number; type: "load"; modelId: string }
  | { id: number; type: "generate"; modelId: string; system: string; messages: { role: string; content: string }[]; maxTokens: number }
  | { id: number; type: "unload" };

let currentModelId = "";
let currentPipeline: any = null;
let loading: Promise<any> | null = null;

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const message = event.data;
  try {
    if (message.type === "unload") {
      try { await currentPipeline?.dispose?.(); } catch {}
      currentPipeline = null;
      currentModelId = "";
      loading = null;
      (self as any).postMessage({ id: message.id, type: "done" });
      return;
    }

    const modelId = message.modelId;
    if (!currentPipeline || currentModelId !== modelId) {
      if (!loading) {
        env.allowLocalModels = false;
        loading = pipeline("text-generation", modelId, {
          dtype: "q4",
          progress_callback: (progress: any) => (self as any).postMessage({ id: message.id, type: "progress", progress }),
        });
      }
      currentPipeline = await loading;
      currentModelId = modelId;
      loading = null;
      (self as any).postMessage({ id: message.id, type: "ready", modelId });
    }

    if (message.type === "load") {
      (self as any).postMessage({ id: message.id, type: "done" });
      return;
    }

    let full = "";
    const streamer = new TextStreamer(currentPipeline.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        if (!chunk) return;
        full += chunk;
        (self as any).postMessage({ id: message.id, type: "text", chunk });
      },
    });
    const result = await currentPipeline(
      [{ role: "system", content: message.system }, ...message.messages],
      { max_new_tokens: message.maxTokens, do_sample: false, streamer },
    );
    if (!full) {
      const generated = result?.[0]?.generated_text;
      if (typeof generated === "string") full = generated;
      else if (Array.isArray(generated)) {
        const last = generated[generated.length - 1];
        if (typeof last?.content === "string") full = last.content;
      }
      if (full) (self as any).postMessage({ id: message.id, type: "text", chunk: full });
    }
    (self as any).postMessage({ id: message.id, type: "done", outputTokensText: full });
  } catch (error) {
    (self as any).postMessage({ id: message.id, type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
