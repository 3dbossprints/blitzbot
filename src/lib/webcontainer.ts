import { WebContainer, type FileSystemTree, type WebContainerProcess } from "@webcontainer/api";

let instance: WebContainer | null = null;
let devProc: WebContainerProcess | null = null;
let serverReadyCb: ((url: string) => void) | null = null;

export function onServerReady(cb: (url: string) => void) {
  serverReadyCb = cb;
}

export async function getContainer(): Promise<WebContainer> {
  if (!crossOriginIsolated) {
    throw new Error(
      "This page isn't cross-origin isolated, so WebContainers can't start. Run via `npm run dev` (headers are preconfigured) or deploy with the required cross-origin-isolation headers enabled.",
    );
  }
  if (!instance) {
    instance = await WebContainer.boot({ workdirName: "blitzbot" });
    instance.on("server-ready", (_port, url) => serverReadyCb?.(url));
    instance.on("error", (err) => console.error("[webcontainer]", err));
  }
  return instance;
}

/** Tear down the running project (kills dev server, wipes the FS by rebooting). */
export async function resetContainer(): Promise<void> {
  try {
    devProc?.kill();
  } catch {
    /* already dead */
  }
  devProc = null;
  if (instance) {
    instance.teardown();
    instance = null;
  }
}

function toTree(files: Record<string, string>): FileSystemTree {
  const root: FileSystemTree = {};
  for (const [path, contents] of Object.entries(files)) {
    const parts = path.split("/").filter(Boolean);
    let node: FileSystemTree = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      const existing = node[dir];
      if (existing && "directory" in existing) {
        node = existing.directory;
      } else {
        const next: FileSystemTree = {};
        node[dir] = { directory: next };
        node = next;
      }
    }
    node[parts[parts.length - 1]] = { file: { contents } };
  }
  return root;
}

export async function mountProject(files: Record<string, string>): Promise<void> {
  const wc = await getContainer();
  await wc.mount(toTree(files));
}

export async function writeProjectFile(path: string, contents: string): Promise<void> {
  const wc = await getContainer();
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir) await wc.fs.mkdir(dir, { recursive: true });
  await wc.fs.writeFile(path, contents);
}

export async function removeProjectFile(path: string): Promise<void> {
  const wc = await getContainer();
  await wc.fs.rm(path, { force: true });
}

export async function runCommand(
  cmd: string,
  args: string[],
  onOutput: (line: string) => void,
): Promise<number> {
  const wc = await getContainer();
  const proc = await wc.spawn(cmd, args);
  proc.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput(data);
      },
    }),
  );
  return proc.exit;
}

export async function startDevServer(onOutput: (line: string) => void): Promise<void> {
  const wc = await getContainer();
  devProc = await wc.spawn("npm", ["run", "dev"]);
  devProc.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput(data);
      },
    }),
  );
}

/**
 * Compile the current generated Vite project inside its WebContainer and return
 * the built static files. The preview server is restarted afterwards.
 */
export async function buildProjectAssets(
  files: Record<string, string>,
  onOutput: (line: string) => void = () => {},
): Promise<Record<string, string>> {
  if (!files["package.json"]) throw new Error("This project has no package.json.");
  if (!files["package.json"].includes('"build"')) throw new Error("Add a build script (for Vite, usually \"vite build\") before deploying.");

  await resetContainer();
  await mountProject(files);
  let assets: Record<string, string> = {};
  let buildError: Error | null = null;
  try {
    onOutput("Installing dependencies for deployment…");
    const installCode = await runCommand("npm", ["install"], onOutput);
    if (installCode !== 0) throw new Error("npm install failed with exit code " + installCode + ".");
    onOutput("Building production assets…");
    const buildCode = await runCommand("npm", ["run", "build"], onOutput);
    if (buildCode !== 0) throw new Error("npm run build failed with exit code " + buildCode + ".");

    const output: Record<string, string> = {};
    async function walk(dir: string): Promise<void> {
      const names = await (await getContainer()).fs.readdir(dir);
      for (const name of names) {
        const path = dir + "/" + name;
        const stat = await (await getContainer()).fs.stat(path);
        if (stat.isDirectory()) {
          await walk(path);
        } else {
          output[path.slice("dist/".length)] = await (await getContainer()).fs.readFile(path, "utf-8");
        }
      }
    }
    await walk("dist");
    if (!output["index.html"]) throw new Error("The build completed but dist/index.html was not found. Check your build output directory.");
    assets = output;
  } catch (error) {
    buildError = error instanceof Error ? error : new Error(String(error));
  } finally {
    // Keep the editor's live preview available after a deploy attempt.
    try { await startDevServer(onOutput); } catch { /* build failure can still be reported clearly */ }
  }
  if (buildError) throw buildError;
  return assets;
}
