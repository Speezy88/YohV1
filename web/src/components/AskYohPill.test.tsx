import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AskYohPill } from "./AskYohPill.tsx";
import * as chatPanel from "../lib/chatPanel.ts";

describe("AskYohPill", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a focusable button synchronously — no gate, no wait", () => {
    render(<AskYohPill />);
    const button = screen.getByRole("button", { name: /ask yoh/i });
    button.focus();
    expect(button).toHaveFocus();
  });

  it("clicking opens the Chat panel", () => {
    const open = vi.spyOn(chatPanel, "openChatPanel").mockImplementation(() => {});
    render(<AskYohPill />);
    fireEvent.click(screen.getByRole("button", { name: /ask yoh/i }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shows the ⌘K hint", () => {
    render(<AskYohPill />);
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });
});
