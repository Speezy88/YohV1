// web/src/pages/Desk.tsx — Story 7.6 placeholder; a later epic builds Desk.
export default function DeskPage(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-6 p-8 pb-24">
      <h1 className="font-body text-display font-bold tracking-tight text-ink-primary">Desk</h1>
      {/* Polish-4 addendum (wheel paging only outside cards): this raised
          card opts out of wheel page-navigation (`data-wheel-nav="off"`,
          `lib/wheelNav.ts`). */}
      <div data-wheel-nav="off" className="flex flex-1 items-center justify-center rounded-2xl bg-surface-raised font-body text-body text-ink-secondary shadow-extruded-lg">
        Desk — coming in a later epic.
      </div>
    </div>
  );
}
