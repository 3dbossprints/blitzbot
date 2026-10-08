import { useState } from "react";
import { useStore } from "../lib/store";

const PHASE_COPY: Record<string, string> = {
  thinking: "The model is writing files…",
  comparing: "Models are racing — pick a winner to boot it.",
  installing: "Installing dependencies in your browser…",
  starting: "Starting the dev server…",
};

export function PreviewPane() {
  const previewUrl = useStore((s) => s.previewUrl);
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className={`pane preview-pane${expanded ? " preview-expanded" : ""}`} aria-label="Live preview">
      <div className="pane-head">
        Preview
        {previewUrl && (
          <button
            className="quiet-link preview-expand"
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Exit expanded preview" : "Expand preview"}
            aria-expanded={expanded}
            title={expanded ? "Return to editor" : "Expand preview"}
          >
            {expanded ? "close ×" : "expand ⤢"}
          </button>
        )}
      </div>
      {previewUrl ? (
        <iframe className="preview-frame" src={previewUrl} title="BlitzBot app preview" allow="cross-origin-isolated" />
      ) : (
        <div className="preview-wait">
          {phase === "error" ? (
            <div className="preview-error">
              <strong>Build failed.</strong>
              <p>{error}</p>
            </div>
          ) : (
            <>
              <div className="pulse-dot" aria-hidden />
              <p>{PHASE_COPY[phase] ?? "Waiting for a build…"}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
