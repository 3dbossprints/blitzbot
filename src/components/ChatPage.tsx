import { useEffect } from "react";
import { useStore } from "../lib/store";
import { ChatPane } from "./ChatPane";

export function ChatPage({ onNavigate, theme, onToggleTheme }: { onNavigate: (page: "home" | "build" | "chat") => void; theme: "light" | "dark"; onToggleTheme: () => void }) {
  const setPref = useStore((s) => s.setPref);
  const startNewProject = useStore((s) => s.startNewProject);
  const setProjectsOpen = useStore((s) => s.setProjectsOpen);\n  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  useEffect(() => {
    setPref({ mode: "ideate" });
  }, [setPref]);

  return (
    <div className="studio dedicated-chat-page">
      <header className="studio-bar">
        <span className="wordmark"><em>Blitz</em>Bot</span>
        <span className="studio-project">Chat with AI</span>
        <div className="studio-actions">
          <button className="btn-ghost btn-sm" onClick={() => setProjectsOpen(true)}>History</button>
          <button className="btn-ghost btn-sm" onClick={() => void startNewProject()}>New chat</button>
          <button className="btn-ghost btn-sm" onClick={() => onNavigate("home")}>Home</button>
          <button className="btn-ghost btn-sm" onClick={() => onNavigate("build")}>Build</button>\n          <button className="btn-ghost btn-sm theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>\n          <button className="btn-ghost btn-sm" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>
      <main className="dedicated-chat-main">
        <div className="dedicated-chat-intro">
          <h1>Chat with AI</h1>
          <p>Ask questions, brainstorm, and debug without changing your project files.</p>
        </div>
        <ChatPane ideateOnly />
      </main>
    </div>
  );
}
