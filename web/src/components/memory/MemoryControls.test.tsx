import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChangedSettingView, MemoryItemView, MemoryViewResponse, NeedsReviewItemView } from "../../../../src/types/api.ts";

vi.mock("../../lib/memory.ts", async (orig) => {
  const actual = await orig<typeof import("../../lib/memory.ts")>();
  return {
    ...actual,
    useChatHistoryList: () => ({
      state: { status: "loaded", value: { conversations: [{ id: "c1", date: "2026-09-29", turnCount: 2, firstLine: "Hello" }] } },
      refetch: vi.fn(),
    }),
  };
});

import { ChangedSettingsPane } from "./ChangedSettingsPane.tsx";
import { NeedsReviewPane } from "./NeedsReviewPane.tsx";
import { MemoryItemRow } from "./MemoryItemRow.tsx";
import { ItemOverflowMenu } from "./ItemOverflowMenu.tsx";
import { MemoryRail } from "./MemoryRail.tsx";
import { MemorySearchBox, MemorySearchResults } from "./MemorySearch.tsx";
import { ChatHistoryPane } from "./ChatHistoryPane.tsx";

const FOCUS = "focus-visible:outline-accent-solid";
const FOLDERS = [{ folder: "about-you", label: "About you" }] as const;

function item(over: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id: "m1", folder: "about-you", text: "Likes early mornings", origin: "inferred", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", confirmedOn: "2026-09-01", loaded: true, earlierVersions: [], ...over,
  };
}
const SETTING: ChangedSettingView = { key: "schoolDayWorkStart", label: "School-day work start", value: "2:30 PM", was: "3:15 PM", changedAt: "2026-09-29T10:00:00Z", changedOn: "2026-09-29" };

function expectShared(buttons: HTMLElement[]): void {
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons) {
    expect(b.className, b.textContent ?? "").toContain(FOCUS);
    expect(b.className).not.toContain("font-semibold");
    expect(b.className).not.toMatch(/disabled:opacity-(40|60)/);
  }
}

describe("Memory controls adopt the shared styles", () => {
  it("Changed settings: Revert is a sm Secondary button", () => {
    render(<ChangedSettingsPane settings={[SETTING]} />);
    const b = screen.getByRole("button", { name: "Revert School-day work start" });
    expectShared([b]);
    expect(b.className).toContain("h-9");
    expect(b.className).toContain("hover:shadow-extruded-md");
  });

  it("Needs review: actions are sm Secondary; the date input has a focus ring", () => {
    const n: NeedsReviewItemView = { ...item(), reason: "Expired Sep 19", canRenew: true, expiresOn: "2026-09-19" };
    render(<NeedsReviewPane items={[n]} folders={FOLDERS} onDelete={vi.fn()} isDissolving={() => false} errorFor={() => undefined} onOpenSource={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    const actions = ["Renew", "Keep as history", "Delete", "Set new expiry", "No expiry"].map((name) => screen.getByRole("button", { name }));
    expectShared(actions);
    for (const a of actions) expect(a.className).toContain("h-9");
    expect(screen.getByLabelText("New expiry").className).toContain(FOCUS);
  });

  it("Memory item: raised hover, edit affordance and links share styles", () => {
    render(<ul><MemoryItemRow item={item({ earlierVersions: [{ id: "v1", text: "old", confirmedAt: "2026-08-01T10:00:00Z", confirmedOn: "2026-08-01" }] })} folders={FOLDERS} onDelete={vi.fn()} /></ul>);
    expect(screen.getByTestId("memory-item").className).toContain("hover:shadow-extruded-md");
    expectShared([screen.getByRole("button", { name: "Edit" }), screen.getByRole("button", { name: /earlier version/ })]);
    expect(screen.getByRole("button", { name: "Edit" }).className).toContain("min-h-6");
  });

  it("Overflow menu: trigger is at least 36px with a focus ring; items are flat rows", () => {
    render(<ItemOverflowMenu itemText="x" currentFolder="about-you" origin="stated" folders={FOLDERS} onMove={vi.fn()} onSetExpiry={vi.fn()} onDelete={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /More actions/ });
    expectShared([trigger]);
    expect(trigger.className).toContain("h-9");
    expect(trigger.className).toContain("w-9");
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    expectShared(items);
    for (const i of items) expect(i.className).toContain("hover:bg-surface-sunken");
    fireEvent.click(screen.getByRole("menuitem", { name: "Set expiry" }));
    expectShared([screen.getByRole("button", { name: "Save" })]);
    expect(screen.getByLabelText("Expires on").className).toContain(FOCUS);
  });

  it("Rail: rows have focus ring and hover; captions are bold", () => {
    const view = {
      folders: [{ folder: "about-you", label: "About you", loadClass: "always", count: 1, items: [] }],
      needsReview: [], changedSettings: [], pendingPatterns: [],
    } as unknown as MemoryViewResponse;
    render(<MemoryRail view={view} selection={{ kind: "folder", folder: "about-you" }} onSelect={vi.fn()} />);
    const rows = screen.getAllByRole("button");
    expectShared(rows);
    for (const r of rows) expect(r.className).toContain("hover:");
    expect(document.querySelector("nav p")?.className).not.toContain("font-semibold");
  });

  it("Search: Clear search and hits share styles", () => {
    const search = {
      text: "mor", setText: vi.fn(), clear: vi.fn(), status: "loaded" as const,
      results: { items: [{ id: "m1", folder: "about-you", text: "Likes mornings" }], turns: [] },
    } as unknown as Parameters<typeof MemorySearchBox>[0]["search"];
    render(<><MemorySearchBox search={search} /><MemorySearchResults search={search} onOpenItem={vi.fn()} onOpenTurn={vi.fn()} /></>);
    expectShared([screen.getByRole("button", { name: "Clear search" })]);
    const hit = screen.getByRole("button", { name: /Likes mornings/ });
    expectShared([hit]);
    expect(hit.className).toContain("hover:shadow-extruded-md");
    expect(screen.getByRole("searchbox").parentElement?.className).toContain("has-[:focus-visible]:outline-accent-solid");
  });

  it("Chat history: list rows, link buttons and the clear-all actions share styles", () => {
    render(<ChatHistoryPane onOpen={vi.fn()} onBack={vi.fn()} />);
    const row = screen.getByRole("button", { name: /Hello/ });
    expectShared([row]);
    expect(row.className).toContain("hover:shadow-extruded-md");
    fireEvent.click(screen.getByRole("button", { name: "Clear all history" }));
    expectShared([screen.getByRole("button", { name: "Clear history" }), screen.getByRole("button", { name: "Cancel" })]);
    expect(screen.getByRole("button", { name: "Clear history" }).className).toContain("h-9");
  });
});
