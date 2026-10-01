import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RatingPrompt } from "./RatingPrompt.tsx";
import * as ratingApi from "../lib/ratingApi.ts";
import type { MessageRating } from "../lib/chatStore.ts";

const RECEIPT = { receiptId: "r1", kind: "remembered" as const, items: [] };

function Harness({ onReceipt = vi.fn() }: { onReceipt?: (r: typeof RECEIPT) => void }): React.JSX.Element {
  const [rating, setRating] = useState<MessageRating>({ promptId: "p1", phase: "open" });
  return <RatingPrompt rating={rating} onChange={(patch) => setRating((r) => ({ ...r, ...patch }))} onReceipt={onReceipt} />;
}

describe("RatingPrompt", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("key 3 on the focused group posts score 3 and folds to Rated 3 (good)", async () => {
    const spy = vi.spyOn(ratingApi, "submitRating").mockResolvedValue({ status: "ok" });
    render(<Harness />);
    expect(screen.getByText("How is Yoh doing?")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "How is Yoh doing?" }), { key: "3" });
    await waitFor(() => expect(screen.getByText("Rated 3 (good)")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith({ promptId: "p1", score: 3 });
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("renders three radios with Poor, Okay, Good and clicking one posts it", async () => {
    const spy = vi.spyOn(ratingApi, "submitRating").mockResolvedValue({ status: "ok" });
    render(<Harness />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["1 Poor", "2 Okay", "3 Good"]);
    fireEvent.click(screen.getByRole("radio", { name: "2 Okay" }));
    await waitFor(() => expect(screen.getByText("Rated 2 (okay)")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith({ promptId: "p1", score: 2 });
  });

  it("chips are shared Secondary buttons (rounded-sm) and Not now is a shared text button", () => {
    render(<Harness />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveClass("rounded-sm", "hover:shadow-extruded-md", "disabled:opacity-50");
      expect(radio).not.toHaveClass("rounded-full", "font-semibold");
    }
    expect(screen.getByRole("button", { name: "Not now" })).toHaveClass("hover:underline", "text-ink-accent");
  });

  it("a 1 asks What was off? and Send posts the note and hands up the receipt", async () => {
    const spy = vi.spyOn(ratingApi, "submitRating").mockResolvedValue({ status: "ok", receipt: RECEIPT });
    const onReceipt = vi.fn();
    render(<Harness onReceipt={onReceipt} />);
    fireEvent.click(screen.getByRole("radio", { name: "1 Poor" }));
    const field = await screen.findByRole("textbox", { name: "What was off?" });
    expect(screen.getByText("Rated 1 (poor)")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: " too wordy " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onReceipt).toHaveBeenCalledWith(RECEIPT));
    expect(spy).toHaveBeenLastCalledWith({ promptId: "p1", score: 1, note: "too wordy" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Rated 1 (poor)")).toBeInTheDocument();
  });

  it("Skip closes the note field without posting", async () => {
    const spy = vi.spyOn(ratingApi, "submitRating").mockResolvedValue({ status: "ok" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "1 Poor" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Not now posts a dismissal and removes the prompt", async () => {
    const spy = vi.spyOn(ratingApi, "submitRating").mockResolvedValue({ status: "ok" });
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(spy).toHaveBeenCalledWith({ promptId: "p1", dismissed: true });
  });

  it("a failed pick keeps the prompt with an inline retry message", async () => {
    vi.spyOn(ratingApi, "submitRating").mockResolvedValue({ status: "failed" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "3 Good" }));
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});
