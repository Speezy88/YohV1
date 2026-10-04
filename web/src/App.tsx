// web/src/App.tsx — Story 7.6 mounts the real page shell. Task 6A (2026-09-27):
// the Theme Toggle moved out of a fixed page corner and into the nav
// sidebar (`Sidebar.tsx`, rendered by `PageShell`), so it no longer needs
// its own wrapper here.
import { useEffect } from "react";
import { startActivityPing } from "./lib/activity.ts";
import { PageShell } from "./components/PageShell.tsx";

export default function App(): React.JSX.Element {
  // Ruling E12-R14: a click or key marks the day as opened; nothing else does.
  useEffect(() => startActivityPing(), []);
  return (
    <div className="bg-surface-base text-ink-primary font-body">
      <PageShell />
    </div>
  );
}
