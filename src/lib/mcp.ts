export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpRpcResponse {
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
  sessionId: string;
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

async function postMcp(
  endpoint: string,
  token: string,
  sessionId: string,
  payload: Record<string, unknown>,
): Promise<McpRpcResponse> {
  const url = endpoint.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("MCP endpoint must start with https:// or http://.");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token.trim()) headers.Authorization = "Bearer " + token.trim();
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const nextSession = response.headers.get("mcp-session-id") || sessionId;
  const bodyText = response.status === 202 || response.status === 204 ? "" : await response.text();
  if (!response.ok) throw new Error("MCP server returned HTTP " + response.status + (bodyText ? ": " + bodyText.slice(0, 300) : ""));
  if (!bodyText.trim()) return { sessionId: nextSession };
  let body: Record<string, any> | null = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    for (const line of bodyText.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { body = JSON.parse(data); } catch { /* continue until JSON SSE event */ }
    }
  }
  if (!body) throw new Error("MCP response was not JSON or a JSON event stream.");
  if (body.error) throw new Error("MCP " + body.error.code + ": " + (body.error.message || "request failed"));
  return { result: body.result, sessionId: nextSession };
}

export async function connectMcp(endpoint: string, token = ""): Promise<{ sessionId: string; serverInfo: Record<string, unknown>; tools: McpTool[] }> {
  const initialized = await postMcp(endpoint, token, "", {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "BlitzBot", version: "0.1.0" },
    },
  });
  const sessionId = initialized.sessionId;
  await postMcp(endpoint, token, sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await postMcp(endpoint, token, sessionId, {
    jsonrpc: "2.0", id: Date.now() + 1, method: "tools/list", params: {},
  });
  const result = asObject(listed.result);
  const tools = Array.isArray(result.tools) ? result.tools.filter((t: unknown) => typeof asObject(t).name === "string") as McpTool[] : [];
  return { sessionId: listed.sessionId, serverInfo: asObject(initialized.result).serverInfo ?? {}, tools };
}

export async function callMcpTool(
  endpoint: string,
  token: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await postMcp(endpoint, token, sessionId, {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name, arguments: args },
  });
  return response.result;
}
