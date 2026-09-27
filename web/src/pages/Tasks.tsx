// web/src/pages/Tasks.tsx — Task 6A gives Tasks the new shell's look only;
// Task 6B (a later task, pulled forward from Epic 11) builds its real
// behavior: the quick-add row, grouped Task list, search, and grouping
// controls the approved mockup (Tasks.dc.html) shows.
export default function TasksPage(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-6 p-8 pb-24">
      <h1 className="font-body text-display font-bold tracking-tight text-ink-primary">Tasks</h1>
      <div className="flex flex-1 items-center justify-center rounded-2xl bg-surface-raised font-body text-body text-ink-secondary shadow-extruded-lg">
        Tasks is arriving in the next task — its look is ready, its behavior isn't yet.
      </div>
    </div>
  );
}
