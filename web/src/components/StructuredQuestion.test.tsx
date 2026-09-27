/**
 * web/src/components/StructuredQuestion.test.tsx — Story 8.6, UX-DR38.
 *
 * The one rendering component for a discrete-answer question: text +
 * option chips (Secondary → Primary on pick) + a free-text "Other" field.
 * Every control is a native `<button>`/`<input>` so Tab order and
 * Enter/Space activation come for free (WCAG 2.1.1).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StructuredQuestion } from "./StructuredQuestion.tsx";

describe("StructuredQuestion", () => {
  it("renders the question text and one chip per option", () => {
    render(
      <StructuredQuestion
        text="What area is Draft the memo?"
        options={[
          { label: "Work", value: "Work" },
          { label: "Personal", value: "Personal" },
        ]}
        allowsFreeText
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText("What area is Draft the memo?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Personal" })).toBeInTheDocument();
  });

  it("picking a chip calls onAnswer with its value and flips the chip to the Primary style", () => {
    const onAnswer = vi.fn();
    render(<StructuredQuestion text="Q" options={[{ label: "Yes", value: "yes" }]} allowsFreeText={false} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onAnswer).toHaveBeenCalledWith("yes");
    expect(screen.getByRole("button", { name: "Yes" })).toHaveClass("bg-gradient-to-br", "from-accent-gradient-start", "to-accent-gradient-end");
  });

  it("chips and Other are native <button>/<input> — reachable by Tab, activatable by Enter/Space with no custom handling", () => {
    render(<StructuredQuestion text="Q" options={[{ label: "Yes", value: "yes" }]} allowsFreeText onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Yes" }).tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Other").tagName).toBe("INPUT");
  });

  it("typing in Other and pressing Enter calls onAnswer with the trimmed text", () => {
    const onAnswer = vi.fn();
    render(<StructuredQuestion text="Q" options={[]} allowsFreeText onAnswer={onAnswer} />);
    fireEvent.change(screen.getByLabelText("Other"), { target: { value: "  something else  " } });
    fireEvent.keyDown(screen.getByLabelText("Other"), { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith("something else");
  });

  it("no options: renders no chips, only the Other field and its Send button", () => {
    render(<StructuredQuestion text="Q" options={[]} allowsFreeText onAnswer={vi.fn()} />);
    expect(screen.getAllByRole("button").length).toBe(1); // Send only
    expect(screen.getByLabelText("Other")).toBeInTheDocument();
  });

  it("allowsFreeText=false renders no Other field at all", () => {
    render(<StructuredQuestion text="Q" options={[{ label: "Yes", value: "yes" }]} allowsFreeText={false} onAnswer={vi.fn()} />);
    expect(screen.queryByLabelText("Other")).not.toBeInTheDocument();
  });

  it("busy disables every chip and the Other field, so a second pick can't race the first (AD-5's conflict rule)", () => {
    render(<StructuredQuestion text="Q" options={[{ label: "Yes", value: "yes" }]} allowsFreeText busy onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Yes" })).toBeDisabled();
    expect(screen.getByLabelText("Other")).toBeDisabled();
  });

  // ==========================================================================
  // Story 8.8 AC3: the first chip is pre-focused on mount, so Enter alone
  // confirms it (the capture flow's "Create" chip). Every real caller gives
  // a genuinely NEW question its own fresh component instance (OpenItems.tsx
  // keys by requestId:questionId; ChatMessage.tsx mounts fresh the instant
  // `question` first appears) — a plain mount-only effect is pinned here by
  // simulating exactly that: unmount + remount for "new question", and a
  // bare rerender (same instance) for "unrelated re-render".
  // ==========================================================================

  it("auto-focuses the first chip when the question mounts, so Enter alone confirms it", () => {
    render(
      <StructuredQuestion
        text="Here's what I'll create in Tasks: title: Lab report draft"
        options={[
          { label: "Create", value: "yes" },
          { label: "Cancel", value: "no" },
        ]}
        allowsFreeText
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Create" })).toHaveFocus();
  });

  it("does NOT steal focus back on a re-render of the SAME question instance (e.g. an unrelated open-items refetch)", () => {
    const { rerender } = render(
      <StructuredQuestion
        text="Q"
        options={[
          { label: "Create", value: "yes" },
          { label: "Cancel", value: "no" },
        ]}
        allowsFreeText={false}
        onAnswer={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: "Cancel" }).focus();
    rerender(
      <StructuredQuestion
        text="Q"
        options={[
          { label: "Create", value: "yes" },
          { label: "Cancel", value: "no" },
        ]}
        allowsFreeText={false}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("focuses the NEW question's first chip when a genuinely new question mounts (e.g. OpenItems.tsx's key-based remount for a fresh confirm)", () => {
    const { unmount } = render(
      <StructuredQuestion text="First" options={[{ label: "Yes", value: "yes" }]} allowsFreeText={false} onAnswer={vi.fn()} />,
    );
    screen.getByRole("button", { name: "Yes" }).blur();
    unmount();
    cleanup();
    render(
      <StructuredQuestion
        text="Second"
        options={[
          { label: "Create", value: "yes" },
          { label: "Cancel", value: "no" },
        ]}
        allowsFreeText={false}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Create" })).toHaveFocus();
  });
});
