import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChangedSettingView } from "../../../../src/types/api.ts";

vi.mock("../../lib/memory.ts", async (orig) => {
  const actual = await orig<typeof import("../../lib/memory.ts")>();
  return { ...actual, revertSetting: vi.fn() };
});

import { ChangedSettingsPane } from "./ChangedSettingsPane.tsx";
import { revertSetting } from "../../lib/memory.ts";

const revert = revertSetting as unknown as ReturnType<typeof vi.fn>;
const SETTING: ChangedSettingView = { key: "schoolDayWorkStart", label: "School-day work start", value: "2:30 PM", was: "3:15 PM", changedAt: "2026-09-29T10:00:00Z", changedOn: "2026-09-29" };

describe("ChangedSettingsPane", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the empty state", () => {
    render(<ChangedSettingsPane settings={[]} />);
    expect(screen.getByText("No planning rules changed.")).toBeInTheDocument();
  });

  it("reads '{label}: {value} (was {was}) - changed {date}' with a Revert button", () => {
    render(<ChangedSettingsPane settings={[SETTING]} />);
    expect(screen.getByText("School-day work start: 2:30 PM (was 3:15 PM) - changed Sep 29")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revert School-day work start" })).toBeInTheDocument();
  });

  it("Revert shows the server message, then the row leaves once the view drops it", async () => {
    revert.mockResolvedValue({ ok: true, value: { message: "Reverted to 3:15 PM." } });
    const { rerender } = render(<ChangedSettingsPane settings={[SETTING]} />);
    fireEvent.click(screen.getByRole("button", { name: "Revert School-day work start" }));
    expect(revert).toHaveBeenCalledWith("schoolDayWorkStart", undefined);
    expect(await screen.findByText("Reverted to 3:15 PM.")).toBeInTheDocument();
    rerender(<ChangedSettingsPane settings={[]} />);
    expect(screen.getByText("Reverted to 3:15 PM.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revert/ })).toBeNull();
  });

  it("a failed Revert keeps the row and shows the message", async () => {
    revert.mockResolvedValue({ ok: false, message: "That setting is already back to its default." });
    render(<ChangedSettingsPane settings={[SETTING]} />);
    fireEvent.click(screen.getByRole("button", { name: "Revert School-day work start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That setting is already back to its default.");
    expect(screen.getByRole("button", { name: "Revert School-day work start" })).toBeEnabled();
  });
});
