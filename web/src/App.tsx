// web/src/App.tsx — Story 7.6 mounts the real page shell. The Theme Toggle
// (Story 7.5) rides along as corner chrome, absolutely positioned above the
// page shell so it's reachable from every page.
import { PageShell } from "./components/PageShell.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";

export default function App(): React.JSX.Element {
  return (
    <div className="bg-surface-base text-ink-primary font-body">
      <div className="fixed right-4 top-4 z-40">
        <ThemeToggle />
      </div>
      <PageShell />
    </div>
  );
}
