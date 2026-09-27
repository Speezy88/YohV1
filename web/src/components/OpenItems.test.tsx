/**
 * web/src/components/OpenItems.test.tsx — Story 8.6, UX-DR36/UX-DR38, AD-5.
 *
 * The top-of-Chat list: one `StructuredQuestion` per open item, answered via
 * `submitOpenItemAnswer` (the same `POST /api/open-items/answer` a typed
 * answer would use), recorded into the transcript, and a stale/conflict
 * rejection rendered honestly rather than the raw error message (Review
 * Focus #4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpenItems } from "./OpenItems.tsx";
import * as openItemsLib from "../lib/openItems.ts";
import * as chatStore from "../lib/chatStore.ts";

const ITEM = {
  requestId: "data-completeness",
  requestKind: "data-completeness",
  promptText: "I need a bit more.",
  question: {
    requestId: "data-completeness",
    questionId: "t1:area",
    text: "What area is Draft the memo?",
    options: [{ label: "Work", value: "Work" }],
    allowsFreeText: true,
  },
};

describe("OpenItems", () => {
  beforeEach(() => {
    vi.spyOn(chatStore, "recordAnsweredOpenItem").mockImplementation(() => {});
  });

  it("renders nothing when there are no open items", () => {
    const { container } = render(<OpenItems items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one StructuredQuestion per item", () => {
    render(<OpenItems items={[ITEM]} />);
    expect(screen.getByText("What area is Draft the memo?")).toBeInTheDocument();
  });

  it("picking a chip calls submitOpenItemAnswer with the request/question ids and the chip's value, then records the exchange", async () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({
      ok: true,
      value: { message: "Got it — Work.", receipts: ["Set area to Work"], next: "done" },
    });
    render(<OpenItems items={[ITEM]} />);

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    await waitFor(() =>
      expect(openItemsLib.submitOpenItemAnswer).toHaveBeenCalledWith({ requestId: "data-completeness", questionId: "t1:area", answer: "Work" }),
    );
    await waitFor(() => expect(chatStore.recordAnsweredOpenItem).toHaveBeenCalledWith("Work", { message: "Got it — Work.", receipts: ["Set area to Work"] }));
  });

  it("echoes the question's proposal back on the answer request when one is present", async () => {
    const proposal = { id: "p1", kind: "field-value", entityId: "t1", entityVersion: "v1", suggested: { area: "Work" }, reason: "recent chat", createdAt: "x" };
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: true, value: { message: "Got it.", receipts: [], next: "done" } });
    render(<OpenItems items={[{ ...ITEM, question: { ...ITEM.question, proposal } }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    await waitFor(() =>
      expect(openItemsLib.submitOpenItemAnswer).toHaveBeenCalledWith({ requestId: "data-completeness", questionId: "t1:area", answer: "Work", proposal }),
    );
  });

  it("a stale-proposal rejection renders honestly and neutrally, never the raw error message, and writes nothing further (Review Focus #4)", async () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: false, kind: "stale-proposal", message: "entity changed since suggested" });
    render(<OpenItems items={[ITEM]} />);

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    await waitFor(() =>
      expect(chatStore.recordAnsweredOpenItem).toHaveBeenCalledWith("Work", { message: "That proposal is out of date — nothing was changed.", receipts: [] }),
    );
  });

  it("a conflict rejection also renders honestly and neutrally", async () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: false, kind: "conflict", message: "answer-open-item: that question is no longer pending" });
    render(<OpenItems items={[ITEM]} />);

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    await waitFor(() =>
      expect(chatStore.recordAnsweredOpenItem).toHaveBeenCalledWith("Work", { message: "That's already been answered elsewhere — nothing was changed.", receipts: [] }),
    );
  });

  it("a chip pick disables the whole card immediately (busy) so a second click can't race the first", () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockReturnValue(new Promise(() => {})); // never resolves
    render(<OpenItems items={[ITEM]} />);
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByRole("button", { name: "Work" })).toBeDisabled();
  });

  it("an answered item's card leaves the list once the answer settles — without waiting for a separate open-items refetch", async () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: true, value: { message: "Got it.", receipts: [], next: "done" } });
    render(<OpenItems items={[ITEM]} />);
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    // Still visible (and disabled) the instant the click fires — the card
    // only disappears once the answer itself has settled.
    expect(screen.getByText("What area is Draft the memo?")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("What area is Draft the memo?")).not.toBeInTheDocument());
  });
});
