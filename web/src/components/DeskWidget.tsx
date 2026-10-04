/**
 * web/src/components/DeskWidget.tsx — one Desk card: a caption-style `h2`
 * header and its content. The card opts out of wheel page-navigation
 * (`data-wheel-nav="off"`, `lib/wheelNav.ts`).
 */
export interface DeskWidgetProps {
  readonly title: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

export function DeskWidget({ title, className = "", children }: DeskWidgetProps): React.JSX.Element {
  return (
    <section data-wheel-nav="off" className={`flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-raised p-5 shadow-extruded-lg ${className}`}>
      <h2 className="m-0 font-body text-small font-medium text-ink-secondary">{title}</h2>
      {children}
    </section>
  );
}

export function DeskWidgetSkeleton({ reducedMotion, className = "" }: { readonly reducedMotion: boolean; readonly className?: string }): React.JSX.Element {
  return <div data-testid="desk-widget-skeleton" className={`h-[132px] rounded-2xl bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"} ${className}`} />;
}
