// web/src/pages/ResearchHub.tsx — Task 6A placeholder (Spencer's
// information-architecture decisions, 2026-09-27): a new fourth page. Its
// real content (the Research Vault list, the "ask a research question" box)
// is Task 6C's job — this ships only the page shell, styled like every
// other page so the stack reads as one finished app while it's built out.
export default function ResearchHubPage(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-6 p-8 pb-24">
      <h1 className="font-body text-display font-bold tracking-tight text-ink-primary">Research Hub</h1>
      <div className="flex flex-1 items-center justify-center rounded-2xl bg-surface-raised font-body text-body text-ink-secondary shadow-extruded-lg">
        Research Hub is arriving in a later task.
      </div>
    </div>
  );
}
