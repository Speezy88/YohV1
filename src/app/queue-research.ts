/**
 * src/app/queue-research.ts
 *
 * Story 11.3 (E11-R8, R10, R11, R16): `/research <question>` stores one queued research job and
 * acknowledges at once. It never searches, never calls a model and asks nothing. The only
 * module allowed to insert a job (tests/layering-rules.test.ts).
 */
import { insertQueuedResearchJobInTx } from "../adapters/job-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";
import type { NotionCreatePageBindingFn } from "./create-item.ts";
import { WEB_SEARCH_NOT_CONFIGURED_REPLY } from "./web-search.ts";

export interface QueueResearchDeps {
  readonly connection?: SqliteConnection;
  readonly webSearchAvailable: boolean;
  readonly getNotionCreatePageBinding: NotionCreatePageBindingFn;
  readonly now: () => Date;
}

export interface QueueResearchInput {
  readonly question: string;
}

const reply = (text: string): Result<ChatTurnResponse, YohError> => ({ ok: true, value: { reply: text, receipts: [] } });

export async function queueResearch(deps: QueueResearchDeps, input: QueueResearchInput): Promise<Result<ChatTurnResponse, YohError>> {
  const question = input.question.trim();
  if (!question) return reply("Say what to research, like /research best budget laptops for college.");
  if (!deps.webSearchAvailable) return reply(WEB_SEARCH_NOT_CONFIGURED_REPLY);
  const binding = deps.getNotionCreatePageBinding();
  if (!binding.ok || !binding.value.config.researchVaultDataSourceId) {
    return reply("The Research Vault isn't set up yet, so there's nowhere to file research.");
  }
  if (!deps.connection) return reply("Background research isn't available right now.");
  const createdAt = deps.now().toISOString();
  const connection = deps.connection;
  try {
    connection.writeTx((tx) => insertQueuedResearchJobInTx(tx, { question, createdAt }));
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err) } };
  }
  return reply("Queued. You'll get a notification when it's on Research Hub.");
}
