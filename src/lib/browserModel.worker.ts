import { pipeline, env, TextStreamer } from "@huggingface/transformers";

type RequestMessage =
  | { id: number; type: "load"; modelId: string }
  | { id: number; type: "generate"; modelId: string; system: string; messages: { role: string; content: string }[]; maxTokens: number }
  | { id: number; type: "unload" };

let currentModelId = "";
let currentPipeline: any = null;
let loading: Promise<any> | null = null;

// A single WASM thread reduces memory pressure on laptops and avoids creating
// a large worker pool just to initialise the small browser-local model.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

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
          // Run on ONNX Runtime WebAssembly rather than auto-selecting WebGPU.
          // The WebGPU/JSEP session was aborting while creating sessions for
          // the 1.5B and 3B models on supported browsers. q4 keeps weights small.
          device: "wasm",
          // The q4 ONNX asset for Qwen2.5-Coder-1.5B is ~1.92 GB and
          // leaves too little headroom for WASM session creation. q4f16 is
          // substantially smaller (~1.34 GB) and is the safer browser asset.
          // Keep q4 for the 0.5B model; use q4f16 for larger selections.
          // The 3B model still exceeds the reliable WASM session memory budget
          // on many browsers even with q4f16. Use the smaller q4f16 asset for
          // 1.5B and q4 for 3B only when it is available; the UI will surface
          // a clear compatibility error if ONNX cannot allocate the session.
          dtype: modelId.includes("0.5B") || modelId.includes("3B") ? "q4" : "q4f16",
          progress_callback: (progress: any) => (self as any).postMessage({ id: message.id, type: "progress", progress }),
        });
      }
      // Always clear a failed load promise. Otherwise every retry in this
      // worker immediately rethrows the same rejection until the page reloads.
      const pendingLoad = loading;
      try {
        currentPipeline = await pendingLoad;
        currentModelId = modelId;
        (self as any).postMessage({ id: message.id, type: "ready", modelId });
      } finally {
        if (loading === pendingLoad) loading = null;
      }
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
