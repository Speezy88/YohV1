// web/src/App.tsx — placeholder root; Story 7.6 replaces this with the real
// page shell. Story 7.5 mounts the Theme Toggle here (Task 5).
import { ThemeToggle } from "./components/ThemeToggle.tsx";

export default function App(): React.JSX.Element {
  return (
    <main className="bg-surface-base text-ink-primary min-h-dvh font-body">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <p className="p-4">Yoh — web client foundation (Story 7.5).</p>
    </main>
  );
}
