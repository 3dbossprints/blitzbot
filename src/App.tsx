import { useEffect, useState } from "react";
import { useStore } from "./lib/store";
import { Landing } from "./components/Landing";
import { Workspace } from "./components/Workspace";
import { ChatPage } from "./components/ChatPage";
import { SettingsModal } from "./components/SettingsModal";
import { PushModal } from "./components/PushModal";
import { ProjectsDrawer } from "./components/ProjectsDrawer";

export default function App() {
  const [page, setPage] = useState<"home" | "build" | "chat">("home");
  const onLanding = page === "home";

  useEffect(() => {
    void useStore.getState().initApp();
  }, []);

  return (
    <div className={`app ${onLanding ? "app-light" : "app-dark"}`}>
      {page === "home" ? <Landing onNavigate={setPage} /> : page === "chat" ? <ChatPage onNavigate={setPage} /> : <Workspace onNavigate={setPage} />}
      <SettingsModal />
      <PushModal />
      <ProjectsDrawer />
    </div>
  );
}
