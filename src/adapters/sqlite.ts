/**
 * src/adapters/sqlite.ts
 *
 * Story 7.1, AD-10 (revised for Phase 2): the ONE file that ever opens
 * Yoh's SQLite file. One connection per process — `shell/ritual-cli.ts`,
 * `shell/server.ts`, and `shell/backup-cli.ts` each call
 * `openSqliteConnection` exactly once in their own `main()` (Story 8.9:
 * `shell/chat-cli.ts` did too, until it was retired) and pass the resulting
 * `SqliteConnection` to every store
 * (`memory-store.ts` today; `notification-store.ts`, `plan-state-store.ts`,
 * `completion-log.ts` in later Phase 2 stories). No store opens its own
 * connection — `tests/sqlite.test.ts`'s source-scan test fails the build if
 * any other `src/` file constructs a `better-sqlite3` database.
 *
 * `writeTx(fn)` is the one transaction primitive every store's multi-step
 * write goes through (AD-10): `BEGIN IMMEDIATE`, not a plain deferred
 * `BEGIN` — see `memory-store.ts`'s original doc comment (carried over to
 * this file's own `writeTx` usage) for why `.immediate()` matters under real
 * cross-process concurrency. A change spanning owners (e.g. a Plan write
 * plus its outbox row, AD-18) runs inside one `writeTx` call, each owner's
 * `...InTx(tx, ...)` function called from inside the same `fn`.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SqliteConfig {
  /** Path to the SQLite file, or `:memory:` for an ephemeral in-process store (tests). */
  readonly databasePath: string;
}

/** The shared per-process handle every store reads and writes through. */
export interface SqliteConnection {
  /** The raw `better-sqlite3` handle — stores use it directly for reads (`.prepare().get()/.all()`) and single-statement writes outside a `writeTx`. */
  readonly db: Database.Database;
  /**
   * Runs `fn` inside `BEGIN IMMEDIATE` (AD-10), committing on return and
   * rolling back (and rethrowing) if `fn` throws. `fn` receives the same
   * `db` handle back so a caller doesn't need to close over it separately.
   */
  writeTx<T>(fn: (db: Database.Database) => T): T;
  /** Closes the underlying connection. Call exactly once per process, after every store built on it is done. */
  close(): void;
}

/**
 * Opens the one SQLite connection this process will use. Creates the
 * containing directory if it doesn't exist yet (mirrors `memory-store.ts`'s
 * original constructor logic — `better-sqlite3` refuses to create a file
 * inside a missing directory), then sets WAL mode, a `busy_timeout` (a
 * genuinely transient lock gets a chance to clear before a conflicting
 * writer's SELECT-then-write surfaces `SQLITE_BUSY`), and `foreign_keys`
 * on, per AD-10.
 */
export function openSqliteConnection(config: SqliteConfig): SqliteConnection {
  if (config.databasePath !== ":memory:") {
    const dir = dirname(config.databasePath);
    if (dir && dir !== "." && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  return {
    db,
    writeTx<T>(fn: (db: Database.Database) => T): T {
      // `better-sqlite3`'s `db.transaction(...)` invokes the wrapped
      // function with whatever arguments the caller passes to `.immediate()`
      // — it does NOT automatically bind `db` as an argument. `fn` is
      // wrapped in a zero-arg closure that calls it with `db` explicitly, so
      // callers of `writeTx` get the documented "`fn` receives the same
      // `db` handle back" contract.
      return db.transaction(() => fn(db)).immediate();
    },
    close(): void {
      db.close();
    },
  };
}
