import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReshufflePreviewCard } from "./ReshufflePreviewCard.tsx";
import type { ReshufflePreviewView } from "../../../src/types/api.ts";

const preview: ReshufflePreviewView = {
  proposalId: "p1",
  requestId: "proposal:p1",
  date: "2026-09-25",
  summary: "Moves Draft the memo to 2:00 PM. Pushes Call the dentist to tomorrow.",
  blocks: [],
  deferredTaskIds: ["t2"],
  needsDataTaskIds: [],
  unplacedRoutineLabels: ["Stretch"],
  expiresAt: "2026-09-25T18:10:00.000Z",
};

function setReducedMotion(reduced: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) => ({ matches: reduced, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null }) as MediaQueryList,
  );
}

describe("ReshufflePreviewCard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the summary with Approve and Discard buttons", () => {
    render(<ReshufflePreviewCard preview={preview} onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.getByText(preview.summary)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.getByText(/Stretch/)).toBeInTheDocument();
  });

  it("shows the summary but leaves announcing to Home's always-mounted live region", () => {
    render(<ReshufflePreviewCard preview={preview} onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.getByText(preview.summary)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a rejected preview shows the reason once and has no Approve", () => {
    const rejected = { ...preview, summary: "That won't fit.", rejectedReason: "That won't fit." };
    render(<ReshufflePreviewCard preview={rejected} onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.getAllByText("That won't fit.")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("calls the handlers", () => {
    const onApprove = vi.fn();
    const onDiscard = vi.fn();
    render(<ReshufflePreviewCard preview={preview} onApprove={onApprove} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onApprove).toHaveBeenCalledWith("p1");
    expect(onDiscard).toHaveBeenCalledWith("p1");
  });

  it("shows an error and a notice visibly, and disables buttons while busy", () => {
    render(<ReshufflePreviewCard preview={preview} busy error="Couldn't update your calendar" notice="The day changed, so here is a fresh preview." onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't update your calendar");
    expect(screen.getByText(/fresh preview/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("shows a rejected reason", () => {
    render(<ReshufflePreviewCard preview={{ ...preview, rejectedReason: "That overlaps Standup." }} onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.getByText("That overlaps Standup.")).toBeInTheDocument();
  });

  it("uses no transition classes under reduced motion", () => {
    setReducedMotion(true);
    render(<ReshufflePreviewCard preview={preview} onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.getByTestId("reshuffle-preview-card").outerHTML).not.toMatch(/transition|animate-/);
  });
});
