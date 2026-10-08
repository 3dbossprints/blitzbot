/**
 * The agent protocol.
 *
 * The model emits complete files inside <blitzbot-file> blocks:
 *
 *   <blitzbot-file path="src/App.tsx">
 *   ...entire file contents...
 *   </blitzbot-file>
 *
 * Anything outside a block is narration and streams into the chat.
 * The parser below is incremental and safe across chunk boundaries.
 */

export const SYSTEM_PROMPT = `You are BlitzBot, an expert coding agent that builds complete, runnable web apps.

OUTPUT PROTOCOL — follow exactly:
- Start with a 1–3 sentence plan in plain prose.
- Then emit EVERY file of the project, each inside its own block:
<blitzbot-file path="relative/path.ext">
(entire file contents, no markdown fences, no truncation, no placeholders)
</blitzbot-file>
- After the last file, end with one short line saying the app is ready.
- Never wrap file contents in \`\`\` fences. Never abbreviate with "..." or "rest unchanged".

PROJECT REQUIREMENTS:
- Vite + React + TypeScript. The project MUST include:
  - package.json with: "private": true, scripts { "dev": "vite --host", "build": "vite build" },
    dependencies react + react-dom, devDependencies vite + @vitejs/plugin-react.
    Keep dependencies MINIMAL — every extra package slows the in-browser install.
  - index.html with <div id="root"> and <script type="module" src="/src/main.tsx">.
  - vite.config.ts using @vitejs/plugin-react.
  - src/main.tsx mounting <App /> into #root.
- Default to a single plain CSS file (src/styles.css) imported from main.tsx, but use Tailwind CSS or another requested framework when the user or selected starter asks for it. Install and configure all required dependencies correctly.\n- Backend integrations: when requested or clearly needed, support Supabase using @supabase/supabase-js and Appwrite using the official appwrite SDK. Put browser-safe configuration in environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APPWRITE_ENDPOINT, VITE_APPWRITE_PROJECT_ID, VITE_APPWRITE_DATABASE_ID); generate .env.example and clear setup docs. Never embed service-role keys, server secrets, or private API keys in client code. For Supabase, explain schema and Row Level Security policies; for Appwrite, explain collections and permissions. Implement real SDK calls rather than fake backend behavior, with loading, empty, and error states. If credentials are not supplied, scaffold the integration and document how to connect a project.
- Code must be complete and correct: all imports resolve, no undefined references, TypeScript-clean.
- Prefer zero extra runtime dependencies unless the task truly requires one.

FOLLOW-UP EDITS:
- When the user asks for changes, re-emit ONLY the files that change, as complete files in <blitzbot-file> blocks. Never emit diffs or partial files.`;

export const IDEATE_PROMPT = `You are BlitzBot in ideation mode: a sharp, blunt technical cofounder helping plan and reason about a project.

RULES:
- Discuss architecture, tradeoffs, features, naming, scope — whatever is asked.
- NEVER emit code files. NEVER use <blitzbot-file> blocks. Small inline snippets (a few lines) are fine when they clarify a point.
- Be concise and decisive. State a recommendation, then the reasoning. No filler.`;

export function ideateContext(paths: string[]): string {
  return paths.length
    ? `Project context — current files (paths only, ask if you need contents): ${paths.join(", ")}`
    : "Project context: no files yet — greenfield.";
}

/** Anthropic requires strictly alternating roles starting with "user";
 *  merge consecutive same-role messages and drop a leading assistant turn. */
export function toAlternating(msgs: { role: "user" | "assistant"; content: string }[]) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of msgs) {
    if (!m.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ ...m });
  }
  while (out.length && out[0].role === "assistant") out.shift();
  return out;
}

export function buildEditContext(files: Record<string, string>): string {
  const MAX = 90_000;
  let out = "CURRENT PROJECT FILES:\n";
  for (const [path, content] of Object.entries(files)) {
    const next = `\n<blitzbot-file path="${path}">\n${content}\n</blitzbot-file>\n`;
    if (out.length + next.length > MAX) {
      out += `\n(…${path} and later files omitted for length — ask if you need them…)\n`;
      break;
    }
    out += next;
  }
  return out;
}

// ------------------------------------------------------------------ parser

export interface ParserCallbacks {
  onNarration: (text: string) => void;
  onFileStart: (path: string) => void;
  onFileDone: (path: string, contents: string) => void;
}

const OPEN_RE = /<blitzbot-file\s+path="([^"]+)"\s*>\r?\n?/;
const CLOSE_TAG = "</blitzbot-file>";
/** Longest prefix of an open tag we might be holding across a chunk boundary. */
const HOLDBACK = 80;

export function createStreamParser(cb: ParserCallbacks) {
  let acc = "";
  let cursor = 0;
  let inFile = false;
  let currentPath = "";

  function pump(final: boolean) {
    for (;;) {
      if (!inFile) {
        const slice = acc.slice(cursor);
        const m = OPEN_RE.exec(slice);
        if (m && m.index !== undefined) {
          const before = slice.slice(0, m.index);
          if (before) cb.onNarration(before);
          cursor += m.index + m[0].length;
          currentPath = m[1];
          inFile = true;
          cb.onFileStart(currentPath);
          continue;
        }
        // No open tag found. Emit narration but hold back a tail in case a
        // tag is split across chunks.
        const safeLen = final ? slice.length : Math.max(0, slice.length - HOLDBACK);
        if (safeLen > 0) {
          cb.onNarration(slice.slice(0, safeLen));
          cursor += safeLen;
        }
        return;
      } else {
        const idx = acc.indexOf(CLOSE_TAG, cursor);
        if (idx === -1) {
          if (final) {
            // Stream ended mid-file (model was cut off). Commit what we have.
            const contents = acc.slice(cursor).replace(/\r?\n$/, "");
            cb.onFileDone(currentPath, contents);
            cursor = acc.length;
            inFile = false;
          }
          return;
        }
        let contents = acc.slice(cursor, idx);
        contents = contents.replace(/\r?\n$/, "");
        cb.onFileDone(currentPath, contents);
        cursor = idx + CLOSE_TAG.length;
        // swallow one trailing newline after the close tag
        if (acc[cursor] === "\r") cursor++;
        if (acc[cursor] === "\n") cursor++;
        inFile = false;
      }
    }
  }

  return {
    push(chunk: string) {
      acc += chunk;
      pump(false);
    },
    end() {
      pump(true);
    },
  };
}

export const README_PROMPT = (userPrompt: string, fileList: string[]) =>
  `Write a concise, professional README.md for this project. It was generated from the prompt: "${userPrompt}". Files: ${fileList.join(
    ", ",
  )}. Include: what it is, quick start (npm install, npm run dev), the stack, and a short file-structure overview. Output ONLY the file via the <blitzbot-file path="README.md"> protocol, nothing else.`;
