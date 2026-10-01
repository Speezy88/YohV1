import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StateMessage } from "./StateMessage.tsx";

describe("StateMessage", () => {
  it("empty: one secondary line, no alert, no button, no glyph", () => {
    const { container } = render(<StateMessage variant="empty" message="Nothing here." detail="Try adding one." />);
    expect(screen.getByText("Nothing here.")).toHaveClass("text-ink-secondary");
    expect(screen.getByText("Try adding one.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("error: role=alert, ink-primary line, decorative 1.8px glyph, optional detail", () => {
    const { container } = render(<StateMessage variant="error" message="Couldn't load Tasks right now." detail="Notion is unreachable." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load Tasks right now.");
    expect(alert).toHaveTextContent("Notion is unreachable.");
    expect(screen.getByText("Couldn't load Tasks right now.")).toHaveClass("text-ink-primary");
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.querySelector("path")).toHaveAttribute("stroke-width", "1.8");
  });

  it("error without onRetry shows no button; with onRetry shows Try again which calls it", () => {
    const { rerender } = render(<StateMessage variant="error" message="x" />);
    expect(screen.queryByRole("button")).toBeNull();
    const onRetry = vi.fn();
    rerender(<StateMessage variant="error" message="x" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
