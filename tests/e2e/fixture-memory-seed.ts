/**
 * Story 13.9: seed data for the Memory page specs (T10b). Lives beside, not inside, `fixture-server.ts`
 * (importing that starts a server) so a node test can load it against `:memory:`.
 * `fixture-server.ts` re-exports the constants and serves `POST /__fixture/seed-memory`.
 */
import type { ChatStore } from "../../src/adapters/chat-store.ts";
import type { MemoryItemStore } from "../../src/adapters/memory-item-store.ts";
import type { SqliteConnection } from "../../src/adapters/sqlite.ts";
import { writeSetting } from "../../src/adapters/settings-store.ts";
import type { IsoDate, MemoryFolder } from "../../src/types/domain.ts";

export interface FixtureMemoryItem {
  readonly key: string;
  readonly folder: MemoryFolder;
  readonly text: string;
  readonly origin: "stated" | "inferred";
  readonly scope?: string;
  /** Days from today (negative = past). */
  readonly expiresInDays?: number;
  /** Index into FIXTURE_CONVERSATIONS[0].turns of the user turn this item came from. */
  readonly sourceTurn?: number;
}

export const FIXTURE_MEMORY_ITEMS: readonly FixtureMemoryItem[] = [
  { key: "about", folder: "about-you", text: "Runs before school on weekdays", origin: "stated", sourceTurn: 0 },
  { key: "feedback", folder: "feedback", text: "Keep answers short in the morning", origin: "stated", scope: "mornings" },
  { key: "inferred", folder: "ideas-notes", text: "Prefers deep work before lunch", origin: "inferred" },
  { key: "expiring", folder: "goals-projects", text: "Finish the science fair poster", origin: "stated", expiresInDays: 14 },
  { key: "expired", folder: "goals-projects", text: "Submit the scholarship form", origin: "stated", expiresInDays: -10 },
];

export interface FixtureConversation {
  readonly daysAgo: number;
  readonly turns: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  /** Index of the user turn that produced a Remembered Receipt (its item is `FIXTURE_MEMORY_ITEMS[0]`). */
  readonly receiptForTurn?: number;
}

export const FIXTURE_CONVERSATIONS: readonly FixtureConversation[] = [
  {
    daysAgo: 1,
    receiptForTurn: 0,
    turns: [
      { role: "user", text: "Remember that I run before school on weekdays" },
      { role: "assistant", text: "Got it. I'll plan around your weekday run." },
      { role: "user", text: "What is due Friday?" },
      { role: "assistant", text: "Your chemistry lab report is due Friday." },
    ],
  },
  {
    daysAgo: 2,
    turns: [
      { role: "user", text: "Move the chemistry lab report to tomorrow" },
      { role: "assistant", text: "Done. It's now due tomorrow." },
      { role: "user", text: "Thanks" },
    ],
  },
];

function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Clears chat history and memory items, then seeds the fixture Conversations, items, one receipt and one setting override. */
export function seedFixtureMemory(
  deps: { readonly connection: SqliteConnection; readonly chatHistory: ChatStore; readonly memoryItems: MemoryItemStore },
  today: IsoDate,
): void {
  const { connection, chatHistory, memoryItems } = deps;
  chatHistory.clearAll();
  memoryItems.clearAll();
  const stored = FIXTURE_CONVERSATIONS.map((c) => {
    const date = addDays(today, -c.daysAgo);
    return c.turns.map((t, i) => chatHistory.appendTurn({ date, role: t.role, text: t.text, at: `${date}T09:0${i}:00.000Z` }));
  });
  const ids: Record<string, string> = {};
  for (const m of FIXTURE_MEMORY_ITEMS) {
    const sourceTurnId = m.sourceTurn !== undefined ? stored[0]![m.sourceTurn]!.id : undefined;
    const item = memoryItems.insert({
      folder: m.folder,
      text: m.text,
      origin: m.origin,
      ...(m.scope !== undefined ? { scope: m.scope } : {}),
      ...(m.expiresInDays !== undefined ? { expiresOn: addDays(today, m.expiresInDays) } : {}),
      ...(sourceTurnId !== undefined ? { sourceTurnId } : {}),
    });
    ids[m.key] = item.id;
  }
  FIXTURE_CONVERSATIONS.forEach((c, ci) => {
    if (c.receiptForTurn === undefined) return;
    const turn = stored[ci]![c.receiptForTurn]!;
    memoryItems.putReceipt({
      receiptId: `fixture-receipt-${ci}`,
      conversationId: turn.conversationId,
      userTurnId: turn.id,
      kind: "remembered",
      itemIds: [ids["about"]!],
      chainIds: [ids["about"]!],
      createdAt: turn.createdAt,
    });
  });
  writeSetting(connection, "schoolDayWorkStart", "16:00");
}
