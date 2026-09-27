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

  // Fix round (2026-09-27 review): the approved mockup's "WAITING ON YOU"
  // eyebrow, accessible as a real heading.
  it("shows a 'Waiting on you' heading above the list", () => {
    render(<OpenItems items={[ITEM]} />);
    expect(screen.getByRole("heading", { name: "Waiting on you" })).toBeInTheDocument();
  });

  it("shows no heading when there are no open items", () => {
    render(<OpenItems items={[]} />);
    expect(screen.queryByRole("heading", { name: "Waiting on you" })).not.toBeInTheDocument();
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

  describe("collapsible when there are many (Task 0)", () => {
    const manyItems = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...ITEM,
        requestId: `r${i}`,
        question: { ...ITEM.question, requestId: `r${i}`, questionId: `t${i}:area`, text: `Question ${i}` },
      }));

    it("shows no toggle, and every card, when there are only a few items", () => {
      render(<OpenItems items={manyItems(3)} />);
      expect(screen.queryByTestId("open-items-toggle")).not.toBeInTheDocument();
      expect(screen.getByText("Question 0")).toBeInTheDocument();
      expect(screen.getByText("Question 2")).toBeInTheDocument();
    });

    it("shows a collapse toggle once there are many, and its own scroll cap on the list", () => {
      render(<OpenItems items={manyItems(4)} />);
      expect(screen.getByTestId("open-items-toggle")).toBeInTheDocument();
      const list = screen.getByTestId("open-items-list");
      expect(list.className).toMatch(/overflow-y-auto/);
    });

    it("collapsing hides every card behind a summary, and expanding restores them", () => {
      render(<OpenItems items={manyItems(5)} />);
      const toggle = screen.getByTestId("open-items-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("open-items-list")).not.toBeInTheDocument();
      expect(screen.queryByText("Question 0")).not.toBeInTheDocument();

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Question 0")).toBeInTheDocument();
    });
  });
});
