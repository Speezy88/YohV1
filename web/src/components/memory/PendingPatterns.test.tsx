import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { OpenItemQuestion } from "../../../../src/types/api.ts";
import { PendingPatterns } from "./PendingPatterns.tsx";
import * as openItems from "../../lib/openItems.ts";
import * as memory from "../../lib/memory.ts";

const q = (over: Partial<OpenItemQuestion> = {}): OpenItemQuestion => ({
  requestId: "proposal:p1", questionId: "confirm", text: "Yoh noticed X.\n5 times since Sep 3\nPlan for that?",
  options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }], allowsFreeText: false,
  proposal: { id: "p1", kind: "pattern", entityId: "e", entityVersion: "new", suggested: { evidence: "5 times since Sep 3" }, reason: "r", createdAt: "2026-09-29T10:00:00Z" },
  ...over,
});
const ok = (over: object = {}) => ({ ok: true as const, value: { message: "Planning 30 extra min for X. Revert it on the Memory page.", receipts: [], next: "done" as const, ...over } });

describe("PendingPatterns", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(memory, "refetchMemory").mockResolvedValue(); });

  it("renders the question as headline, evidence caption and prompt with Yes/No, no free text and no focus theft", () => {
    render(<ul><PendingPatterns questions={[q()]} /></ul>);
    expect(screen.getByText("5 times since Sep 3")).toBeInTheDocument();
    expect(screen.getByText("Plan for that?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).not.toHaveFocus();
    expect(screen.queryByLabelText("Other")).toBeNull();
  });

  it("Yes submits through the one answer path, shows the message and the receipt line, then refetches", async () => {
    const submit = vi.spyOn(openItems, "submitOpenItemAnswer").mockResolvedValue({
      ...ok({ receipt: { receiptId: "r", kind: "remembered", items: [{ id: "m", text: "Plan 30 extra min for X", folder: "patterns" }] } }),
    } as never);
    render(<ul><PendingPatterns questions={[q()]} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.getByText("Planning 30 extra min for X. Revert it on the Memory page.")).toBeInTheDocument());
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ requestId: "proposal:p1", questionId: "confirm", answer: "yes" }));
    expect(screen.getByText(/Remembered: Plan 30 extra min for X/)).toBeInTheDocument();
    expect(memory.refetchMemory).toHaveBeenCalled();
  });

  it("a conflict shows the honest line and refetches", async () => {
    vi.spyOn(openItems, "submitOpenItemAnswer").mockResolvedValue({ ok: false, kind: "conflict", message: "raw" });
    render(<ul><PendingPatterns questions={[q()]} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(screen.getByText(openItems.HONEST_REJECTION["conflict"]!)).toBeInTheDocument());
    expect(memory.refetchMemory).toHaveBeenCalled();
  });

  it("a network failure keeps the card and says so plainly", async () => {
    vi.spyOn(openItems, "submitOpenItemAnswer").mockResolvedValue({ ok: false, kind: "unreachable", message: "raw" });
    render(<ul><PendingPatterns questions={[q()]} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.getByText("I couldn't reach Yoh's server just now.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });
});
