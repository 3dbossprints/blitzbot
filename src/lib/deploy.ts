import { makeZip } from "./zip";

export interface DeploymentResult {
  provider: "vercel" | "netlify";
  url: string;
  id?: string;
  state?: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "blitzbot-project";
}

function errorMessage(payload: any, fallback: string): string {
  return payload?.error?.message || payload?.message || payload?.error || fallback;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const raw = response.status === 204 ? "" : await response.text();
  let body: any = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = { message: raw.slice(0, 500) }; }
  }
  if (!response.ok) {
    const reason = errorMessage(body, "HTTP " + response.status);
    if (response.status === 401 || response.status === 403) {
      throw new Error(reason + " — check the token and its access permissions.");
    }
    throw new Error(reason + " (HTTP " + response.status + ").");
  }
  return body;
}

export async function deployToNetlify(
  assets: Record<string, string>,
  token: string,
  projectName: string,
): Promise<DeploymentResult> {
  if (!token.trim()) throw new Error("Enter a Netlify personal access token in Settings → Deployment.");
  if (!assets["index.html"]) throw new Error("The production build is missing index.html.");
  // Netlify's documented ZIP endpoint accepts a site archive directly and creates the site+deploy.
  const body = await fetchJson("https://api.netlify.com/api/v1/sites", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token.trim(),
      "Content-Type": "application/zip",
      Accept: "application/json",
    },
    body: makeZip(assets),
  });
  const url = body.ssl_url || body.deploy_ssl_url || body.url;
  if (!url) throw new Error("Netlify accepted the request but did not return a site URL. Check your Netlify dashboard.");
  return { provider: "netlify", url, id: body.id, state: body.state || body.processing_state };
}

export async function deployToVercel(
  assets: Record<string, string>,
  token: string,
  projectName: string,
  onProgress: (message: string) => void = () => {},
): Promise<DeploymentResult> {
  if (!token.trim()) throw new Error("Enter a Vercel access token in Settings → Deployment.");
  const entries = Object.entries(assets);
  if (!assets["index.html"]) throw new Error("The production build is missing index.html.");
  const uploaded: { file: string; sha: string; size: number }[] = [];
  let nextIndex = 0;
  let firstError: Error | null = null;
  async function worker() {
    while (firstError === null) {
      const index = nextIndex++;
      if (index >= entries.length) return;
      const [file, source] = entries[index];
      try {
        const bytes = new TextEncoder().encode(source);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
        const sha = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
        const url = "https://api.vercel.com/v2/files?digest=" + encodeURIComponent(sha);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token.trim(),
            "Content-Type": "application/octet-stream",
            "x-vercel-digest": sha,
          },
          body: bytes,
        });
        const raw = response.status === 204 ? "" : await response.text();
        let body: any = {};
        if (raw) { try { body = JSON.parse(raw); } catch { body = { message: raw }; } }
        if (!response.ok && response.status !== 409) {
          throw new Error(errorMessage(body, "Upload failed with HTTP " + response.status));
        }
        uploaded.push({ file, sha, size: bytes.byteLength });
        onProgress("Uploaded " + uploaded.length + " of " + entries.length + " files…");
      } catch (error) {
        firstError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => worker()));
  if (firstError) throw firstError;

  onProgress("Creating Vercel deployment…");
  const name = slugify(projectName);
  const created = await fetchJson("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name,
      files: uploaded,
      projectSettings: {
        framework: null,
        buildCommand: null,
        installCommand: null,
        outputDirectory: null,
      },
      target: "production",
    }),
  });
  const id = created.id as string | undefined;
  let state = String(created.readyState || created.status || "QUEUED");
  let url = String(created.alias?.[0] || created.url || "");
  if (!id) throw new Error("Vercel accepted the deployment request but returned no deployment ID.");
  // Poll until Vercel reports a terminal state. Stop after 2 minutes rather than wait forever.
  for (let attempt = 0; attempt < 24 && !["READY", "ERROR", "CANCELED"].includes(state.toUpperCase()); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const status = await fetchJson("https://api.vercel.com/v13/deployments/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + token.trim(), Accept: "application/json" },
    });
    state = String(status.readyState || status.status || state);
    url = String(status.alias?.[0] || status.url || url);
    onProgress("Vercel build state: " + state + "…");
  }
  if (state.toUpperCase() === "ERROR") {
    throw new Error("Vercel deployment failed during build. Open the deployment in Vercel to view build logs.");
  }
  if (!url) throw new Error("Deployment created, but Vercel has not assigned a URL yet. Check the Vercel dashboard.");
  return { provider: "vercel", url: /^https?:\/\//.test(url) ? url : "https://" + url, id, state };
}
