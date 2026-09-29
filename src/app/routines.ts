/**
 * src/app/routines.ts
 *
 * Epic 10 (10.3, R8): declare, change, remove and list Routines from chat.
 * `handled: false` means "not a routine request" (a change/remove line whose
 * label matches no stored routine and never said "routine") — the caller falls
 * through to the rest of its dispatch chain.
 */
import { getRoutine, listRoutines, removeRoutine, upsertRoutine } from "../adapters/routine-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { describeRoutine, routineIdForLabel, type Routine, type RoutineCommand } from "../core/routine-commands.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface ManageRoutineDeps {
  readonly connection: SqliteConnection;
}

export interface ManageRoutineOutput {
  readonly handled: boolean;
  readonly reply: string;
}

const NOT_HANDLED: ManageRoutineOutput = { handled: false, reply: "" };

export async function manageRoutine(deps: ManageRoutineDeps, input: RoutineCommand): Promise<Result<ManageRoutineOutput, YohError>> {
  try {
    const { connection } = deps;
    switch (input.kind) {
      case "list": {
        const routines = listRoutines(connection);
        if (routines.length === 0) {
          return ok(`You haven't set any routines. Say something like "my commute is 3:00–3:30 on weekdays".`);
        }
        return ok(["Your routines:", ...routines.map((r) => `- ${r.label}: ${describeRoutine(r)}`)].join("\n"));
      }
      case "add": {
        const id = routineIdForLabel(input.label);
        const existed = getRoutine(connection, id) !== undefined;
        const routine: Routine = { id, label: input.label, days: input.days, startMinutes: input.startMinutes, durationMinutes: input.durationMinutes };
        upsertRoutine(connection, routine);
        return ok(`${existed ? "Updated" : "Added"} your ${routine.label}: ${describeRoutine(routine)}.`);
      }
      case "change": {
        const existing = getRoutine(connection, routineIdForLabel(input.label));
        if (!existing) {
          return input.explicit ? ok(`I don't have a routine called ${input.label}.`) : { ok: true, value: NOT_HANDLED };
        }
        const routine: Routine = {
          ...existing,
          days: input.days ?? existing.days,
          startMinutes: input.startMinutes ?? existing.startMinutes,
          durationMinutes: input.durationMinutes ?? existing.durationMinutes,
        };
        upsertRoutine(connection, routine);
        return ok(`Updated your ${routine.label}: ${describeRoutine(routine)}.`);
      }
      case "remove": {
        const removed = removeRoutine(connection, routineIdForLabel(input.label));
        return ok(removed ? `Removed your ${input.label} routine.` : `I don't have a routine called ${input.label}.`);
      }
    }
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err) } };
  }
}

function ok(reply: string): Result<ManageRoutineOutput, YohError> {
  return { ok: true, value: { handled: true, reply } };
}
