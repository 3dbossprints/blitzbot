import { useEffect } from "react";
import { useStore } from "../lib/store";
import { ChatPane } from "./ChatPane";

export function ChatPage({ onNavigate }: { onNavigate: (page: "home" | "build" | "chat") => void }) {
  const setPref = useStore((s) => s.setPref);
  useEffect(() => {
    setPref({ mode: "ideate" });
  }, [setPref]);

  return (
    <div className="studio dedicated-chat-page">
      <header className="studio-bar">
        <span className="wordmark"><em>Blitz</em>Bot</span>
        <span className="studio-project">Chat with AI</span>
        <div className="studio-actions">
          <button className="btn-ghost btn-sm" onClick={() => onNavigate("home")}>Home</button>
          <button className="btn-ghost btn-sm" onClick={() => onNavigate("build")}>Build</button>
        </div>
      </header>
      <main className="dedicated-chat-main">
        <div className="dedicated-chat-intro">
          <h1>Chat with AI</h1>
          <p>Ask questions, brainstorm, and debug without changing your project files.</p>
        </div>
        <ChatPane />
      </main>
    </div>
  );
}
