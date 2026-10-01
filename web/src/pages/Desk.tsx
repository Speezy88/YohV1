// web/src/pages/Desk.tsx — Story 7.6 placeholder (copy: Polish 6 P6-R8).
import { StateMessage } from "../components/StateMessage.tsx";

export default function DeskPage(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-5 p-8 pb-24">
      <h1 className="font-body text-display font-bold tracking-tight text-ink-primary">Desk</h1>
      {/* Polish-4 addendum (wheel paging only outside cards): this raised
          card opts out of wheel page-navigation (`data-wheel-nav="off"`,
          `lib/wheelNav.ts`). */}
      <div data-wheel-nav="off" className="flex flex-1 items-center justify-center rounded-2xl bg-surface-raised p-6 shadow-extruded-lg">
        <StateMessage variant="empty" message="Desk isn't built yet." />
      </div>
    </div>
  );
}
