import { useEffect, useState } from "react";
import { useStore } from "./lib/store";
import { Landing } from "./components/Landing";
import { Workspace } from "./components/Workspace";
import { ChatPage } from "./components/ChatPage";
import { SettingsModal } from "./components/SettingsModal";
import { PushModal } from "./components/PushModal";
import { ProjectsDrawer } from "./components/ProjectsDrawer";
type Theme = "light" | "dark";
const THEME_KEY = "blitzbot.theme.v1";
export default function App() {
  const [page, setPage] = useState<"home" | "build" | "chat">("home");
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem(THEME_KEY) as Theme) || "light"; } catch { return "light"; }
  });
  const navigate = (next: "home" | "build" | "chat") => {
    if (next === "build") useStore.getState().setPref({ mode: "build" });
    setPage(next);
  };
  const toggleTheme = () => setTheme((current) => {
    const next = current === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
    return next;
  });
  useEffect(() => { void useStore.getState().initApp(); }, []);
  return <div className={`app app-${theme}`}>
    {page === "home" ? <Landing onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} /> : page === "chat" ? <ChatPage onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} /> : <Workspace onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} />}
    <SettingsModal /><PushModal /><ProjectsDrawer />
  </div>;
}
