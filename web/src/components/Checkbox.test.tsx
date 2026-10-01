import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Checkbox } from "./Checkbox.tsx";
import { FOCUS_RING, CONTROL_DISABLED } from "../lib/controlStyles.ts";

describe("Checkbox", () => {
  it("keeps role, name and aria-checked and calls onCheck", () => {
    const onCheck = vi.fn();
    render(<Checkbox label="Buy milk" checked={false} onCheck={onCheck} />);
    const box = screen.getByRole("checkbox", { name: "Buy milk" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("has the focus ring and disabled treatment, and the drawn box rims to accent-solid on hover", () => {
    render(<Checkbox label="A" checked={false} onCheck={() => {}} />);
    const button = screen.getByRole("checkbox");
    expect(button.className).toContain(FOCUS_RING);
    expect(button.className).toContain(CONTROL_DISABLED);
    expect(button.querySelector("[data-checkbox-box]")!.className).toContain("group-hover:border-accent-solid");
  });

  it.each(["sm", "lg"] as const)("%s: the drawn box keeps its size and the hit area is at least 24px", (size) => {
    render(<Checkbox label="A" checked={false} size={size} onCheck={() => {}} />);
    const button = screen.getByRole("checkbox");
    const drawn = button.querySelector("[data-checkbox-box]") as HTMLElement;
    expect(drawn.className).toContain(size === "sm" ? "size-[17px]" : "size-[26px]");
    expect(button.className).toMatch(size === "sm" ? /\bsize-6\b/ : /size-\[26px\]/);
  });
});
