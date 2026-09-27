/**
 * Tests for `src/adapters/notification-store.ts` (Story 7.3, AD-10/AD-18).
 * In-memory SQLite through the shared `openSqliteConnection` (Story 7.1) —
 * the store never opens its own connection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import {
  appendOutboxInTx,
  createNotification,
  createNotificationInTx,
  getMaxOutboxSeq,
  initNotificationStoreSchema,
  listUnreadNotifications,
  markNotificationRead,
  NOTIFICATION_TOPIC,
  OUTBOX_POLL_INTERVAL_MS,
  tailOutboxSince,
  type CreateNotificationInput,
} from "../src/adapters/notification-store.ts";

const T0 = "2026-09-25T00:00:00.000Z";

function tempStore() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return connection;
}

function input(overrides: Partial<CreateNotificationInput> = {}): CreateNotificationInput {
  return {
    kind: "operational",
    title: "Notion sign-in expired",
    body: "Reconnect Notion to keep writes flowing.",
    deepLink: null,
    createdAt: T0,
    ...overrides,
  };
}

test("OUTBOX_POLL_INTERVAL_MS is the one ~2 s poll-interval export (Shared tuning constants)", () => {
  assert.equal(OUTBOX_POLL_INTERVAL_MS, 2000);
});

test("OUTBOX_POLL_INTERVAL_MS is declared in notification-store.ts and nowhere else in src/", () => {
  const srcDir = join(import.meta.dirname, "..", "src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts") && /\b(?:const|let|var)\s+OUTBOX_POLL_INTERVAL_MS\b/.test(readFileSync(full, "utf8"))) {
        offenders.push(relative(srcDir, full));
      }
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, ["adapters/notification-store.ts"]);
});

test("initNotificationStoreSchema is idempotent and keeps existing rows", () => {
  const connection = tempStore();
  createNotification(connection, input());
  initNotificationStoreSchema(connection.db);
  assert.equal(listUnreadNotifications(connection).length, 1);
  connection.close();
});

test("the notifications and outbox tables have AD-18's columns", () => {
  const connection = tempStore();
  const cols = (table: string) =>
    (connection.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(cols("notifications"), ["id", "kind", "title", "body", "deep_link", "created_at", "read_at"]);
  assert.deepEqual(cols("outbox").slice(0, 3), ["seq", "topic", "entity_id"]);
  connection.close();
});

test("createNotificationInTx writes the notification AND its outbox row inside the caller's writeTx", () => {
  const connection = tempStore();
  const id = connection.writeTx((tx) => createNotificationInTx(tx, input({ kind: "needs-data", deepLink: "/tasks" })));

  const unread = listUnreadNotifications(connection);
  assert.deepEqual(unread, [
    {
      id,
      kind: "needs-data",
      title: "Notion sign-in expired",
      body: "Reconnect Notion to keep writes flowing.",
      deepLink: "/tasks",
      createdAt: T0,
    },
  ]);
  assert.deepEqual(tailOutboxSince(connection, 0), [{ seq: 1, topic: NOTIFICATION_TOPIC, entityId: id }]);
  connection.close();
});

test("the notification row and its outbox row commit atomically — a throw later in the same writeTx rolls back both", () => {
  const connection = tempStore();
  assert.throws(() =>
    connection.writeTx((tx) => {
      createNotificationInTx(tx, input());
      throw new Error("another owner's write failed");
    }),
  );
  assert.equal(listUnreadNotifications(connection).length, 0);
  assert.equal(getMaxOutboxSeq(connection), 0);
  connection.close();
});

test("createNotificationInTx and appendOutboxInTx compose with another owner's write in one writeTx (AD-10)", () => {
  const connection = tempStore();
  connection.db.exec("CREATE TABLE other_owner (id TEXT PRIMARY KEY)");
  connection.writeTx((tx) => {
    tx.prepare("INSERT INTO other_owner (id) VALUES ('x')").run();
    appendOutboxInTx(tx, { topic: "plan", entityId: "2026-09-25" });
    createNotificationInTx(tx, input());
  });
  assert.deepEqual(
    tailOutboxSince(connection, 0).map((h) => h.topic),
    ["plan", NOTIFICATION_TOPIC],
  );
  connection.close();
});

test("createNotification (single-owner convenience) returns the id and writes both rows", () => {
  const connection = tempStore();
  const id = createNotification(connection, input());
  assert.equal(listUnreadNotifications(connection)[0]!.id, id);
  assert.equal(tailOutboxSince(connection, 0)[0]!.entityId, id);
  connection.close();
});

test("an operational notification reads back with deepLink: null and no readAt key (Ruling R11)", () => {
  const connection = tempStore();
  createNotification(connection, input());
  const [record] = listUnreadNotifications(connection);
  assert.equal(record!.deepLink, null);
  assert.equal("readAt" in record!, false);
  connection.close();
});

test("listUnreadNotifications is oldest first", () => {
  const connection = tempStore();
  const later = createNotification(connection, input({ createdAt: "2026-09-25T02:00:00.000Z" }));
  const earlier = createNotification(connection, input({ createdAt: "2026-09-25T01:00:00.000Z" }));
  assert.deepEqual(
    listUnreadNotifications(connection).map((n) => n.id),
    [earlier, later],
  );
  connection.close();
});

test("markNotificationRead sets readAt, drops it from the unread list, and appends an outbox hint", () => {
  const connection = tempStore();
  const id = createNotification(connection, input());
  const result = markNotificationRead(connection, id, "2026-09-25T01:00:00.000Z");
  assert.deepEqual(result, { status: "marked", readAt: "2026-09-25T01:00:00.000Z" });
  assert.equal(listUnreadNotifications(connection).length, 0);
  assert.deepEqual(tailOutboxSince(connection, 1), [{ seq: 2, topic: NOTIFICATION_TOPIC, entityId: id }]);
  connection.close();
});

test("markNotificationRead is idempotent: an already-read notification keeps its first readAt and appends no hint", () => {
  const connection = tempStore();
  const id = createNotification(connection, input());
  markNotificationRead(connection, id, "2026-09-25T01:00:00.000Z");
  const again = markNotificationRead(connection, id, "2026-09-25T05:00:00.000Z");
  assert.deepEqual(again, { status: "already-read", readAt: "2026-09-25T01:00:00.000Z" });
  assert.equal(getMaxOutboxSeq(connection), 2);
  connection.close();
});

test("markNotificationRead reports not-found for an unknown id and writes nothing", () => {
  const connection = tempStore();
  assert.deepEqual(markNotificationRead(connection, "nope", T0), { status: "not-found" });
  assert.equal(getMaxOutboxSeq(connection), 0);
  connection.close();
});

test("getMaxOutboxSeq is 0 for an empty outbox, else the highest seq", () => {
  const connection = tempStore();
  assert.equal(getMaxOutboxSeq(connection), 0);
  connection.writeTx((tx) => {
    appendOutboxInTx(tx, { topic: "plan", entityId: "a" });
    appendOutboxInTx(tx, { topic: "plan", entityId: "b" });
  });
  assert.equal(getMaxOutboxSeq(connection), 2);
  connection.close();
});

test("tailOutboxSince returns only rows with seq > sinceSeq, in seq order, as {seq, topic, entityId}", () => {
  const connection = tempStore();
  connection.writeTx((tx) => {
    for (const id of ["a", "b", "c"]) appendOutboxInTx(tx, { topic: "plan", entityId: id });
  });
  assert.deepEqual(tailOutboxSince(connection, 1), [
    { seq: 2, topic: "plan", entityId: "b" },
    { seq: 3, topic: "plan", entityId: "c" },
  ]);
  connection.close();
});

test("outbox seq is monotonic and never reused, even after the newest row is deleted", () => {
  const connection = tempStore();
  connection.writeTx((tx) => appendOutboxInTx(tx, { topic: "plan", entityId: "a" }));
  connection.db.exec("DELETE FROM outbox"); // test-only: simulate a future prune
  connection.writeTx((tx) => appendOutboxInTx(tx, { topic: "plan", entityId: "b" }));
  assert.equal(tailOutboxSince(connection, 0)[0]!.seq, 2);
  connection.close();
});

test("a check-in or progress notification can't be constructed: kind is the closed NotificationKind union (AD-18, FR-49)", () => {
  // @ts-expect-error "check-in" is not a NotificationKind.
  const checkIn: CreateNotificationInput = { ...input(), kind: "check-in" };
  // @ts-expect-error "progress" is not a NotificationKind.
  const progress: CreateNotificationInput = { ...input(), kind: "progress" };
  // @ts-expect-error a plain string is not a NotificationKind either.
  const widened: CreateNotificationInput = { ...input(), kind: "operational" as string };
  // @ts-expect-error deepLink is a required key (Ruling R11) — "no link" is null, never omitted.
  const noLink: CreateNotificationInput = { kind: "operational", title: "t", body: "b", createdAt: T0 };
  assert.ok(checkIn && progress && widened && noLink);
});

test("every process that may raise a notification creates the tables on startup: the server and the cron one-shots (AD-10, AD-18)", () => {
  for (const entry of ["server.ts", "ritual-cli.ts"]) {
    const source = readFileSync(join(import.meta.dirname, "..", "src", "shell", entry), "utf8");
    assert.match(source, /\binitNotificationStoreSchema\(connection\.db\)/, `${entry} must init the notification store`);
  }
});

test("chat-cli.ts also creates the notification/outbox tables on startup (Story 8.6, AD-10/AD-18): every open-interaction-request write now appends an outbox row unconditionally (memory-store.ts's put/clear/updateDetail), so a fresh install's first answered item would otherwise throw 'no such table: outbox'", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "shell", "chat-cli.ts"), "utf8");
  assert.match(source, /\binitNotificationStoreSchema\(connection\.db\)/, "chat-cli.ts's main() must init the notification store before any interaction-request write can happen");
});

test("only notification-store.ts touches the notifications and outbox tables (AD-10)", () => {
  const srcDir = join(import.meta.dirname, "..", "src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) {
        const sql = readFileSync(full, "utf8");
        if (/\b(?:FROM|INTO|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+(?:notifications|outbox)\b/i.test(sql)) {
          offenders.push(relative(srcDir, full));
        }
      }
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, ["adapters/notification-store.ts"]);
});
