/**
 * src/app/commands.ts
 *
 * Story 8.7 (UX-DR38, FR-42): the ONE server-provided command registry the
 * Web Command Palette (`GET /api/commands`) and `chatTurn`'s slash-dispatch
 * (`app/chat-turn.ts`) both read from — so `/sandbox` (Epic 9) and
 * `/research` (Epic 11) appear everywhere the moment their own story
 * appends an entry here, with no second list to keep in sync and no
 * change to the dispatch mechanism itself.
 */
import type { CommandDescriptor, CommandList } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export const COMMANDS: readonly CommandDescriptor[] = [
  {
    name: "/morning",
    description: "Shows today's stored Plan, its reasoning line, and any pending questions or proposals — never a push, never a regeneration.",
    example: "/morning",
  },
  {
    name: "/night",
    description: "Runs the Night Ritual close-out interactively, and cancels tonight's scheduled prompt and escalation once you're done.",
    example: "/night",
  },
  {
    name: "/plan",
    description: "Builds today's Plan right now, if it doesn't exist yet — same as the 6am Morning Ritual, but on demand and in-app only (no push).",
    example: "/plan",
  },
  {
    name: "/sandbox",
    description: "Walks through every Task missing a Due Date or Estimated Duration, one card at a time, with a live count.",
    example: "/sandbox",
  },
];

/** `GET /api/commands` (C5) and `chatTurn`'s slash-dispatch both call this — the registry, verbatim, wrapped in a `Result`. */
export async function listCommands(_deps: Record<string, never>, _input: Record<string, never>): Promise<Result<CommandList, YohError>> {
  return { ok: true, value: { commands: COMMANDS } };
}
