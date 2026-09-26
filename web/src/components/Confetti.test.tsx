/**
 * web/src/components/Confetti.test.tsx — Story 7.8, UX-DR46.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Confetti } from "./Confetti.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";

describe("Confetti", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders on Feb 19, once per day", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    render(<Confetti today="2026-02-19" />);
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });

  it("never renders on any other date", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    render(<Confetti today="2026-02-20" />);
    expect(screen.queryByTestId("confetti")).not.toBeInTheDocument();
  });

  it("never renders under reduced motion, even on Feb 19", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<Confetti today="2026-02-19" />);
    expect(screen.queryByTestId("confetti")).not.toBeInTheDocument();
  });

  it("does not render a second time the same day after a remount", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    const { unmount } = render(<Confetti today="2026-02-19" />);
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
    unmount();
    render(<Confetti today="2026-02-19" />);
    expect(screen.queryByTestId("confetti")).not.toBeInTheDocument();
  });

  it("a DIFFERENT Feb 19 (a later year) plays again — the dedupe key is the exact date string, not just the month/day", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    const { unmount } = render(<Confetti today="2026-02-19" />);
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
    unmount();
    render(<Confetti today="2027-02-19" />);
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });

  it("renders no emoji or text content — accent-solid/neutral-ink pieces only (UX-DR50)", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    render(<Confetti today="2026-02-19" />);
    expect(screen.getByTestId("confetti").textContent).toBe("");
  });

  it("degrades gracefully (still plays) when localStorage throws", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Confetti today="2026-02-19" />);
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
    spy.mockRestore();
  });

  describe("Fix round 1 (finding #5): duration comes from the one --duration-confetti token; removal waits for every piece's real animationend", () => {
    it("every piece's animation reads the --duration-confetti CSS token, never a hard-coded second value", () => {
      vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
      render(<Confetti today="2026-02-19" />);
      const pieces = screen.getAllByTestId("confetti-piece");
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces) {
        expect(piece.style.animationDuration).toBe("var(--duration-confetti)");
      }
    });

    it("stays mounted while only SOME pieces have finished falling", () => {
      vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
      render(<Confetti today="2026-02-19" />);
      const pieces = screen.getAllByTestId("confetti-piece");
      for (const piece of pieces.slice(0, pieces.length - 1)) {
        fireEvent.animationEnd(piece);
      }
      expect(screen.getByTestId("confetti")).toBeInTheDocument();
    });

    it("unmounts only once EVERY piece has finished falling — never mid-fall", () => {
      vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
      render(<Confetti today="2026-02-19" />);
      const pieces = screen.getAllByTestId("confetti-piece");
      for (const piece of pieces) {
        fireEvent.animationEnd(piece);
      }
      expect(screen.queryByTestId("confetti")).not.toBeInTheDocument();
    });
  });
});
