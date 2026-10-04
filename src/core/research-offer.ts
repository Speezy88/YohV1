/**
 * src/core/research-offer.ts
 *
 * Story 11.4 (E11-R14): a pure, zero-model-call recognizer for an obviously research-sized
 * message that was NOT sent with `/research`. `chatTurn` answers a match with a one-time
 * Yes/No offer to queue research. The boundary follows `search-intent.ts`: planning lines,
 * first-person lines (on the depth-phrase path), slash commands and `search:` never match.
 */
import { CUE_PATH_FIRST_PERSON_RE, PLANNING_NOUN_RE, POLITE_LEAD } from "./search-intent.ts";

/** The `Proposal.kind` of a research offer. */
export const RESEARCH_OFFER_KIND = "research-offer";
/** The one question the offer card asks. */
export const RESEARCH_OFFER_PROMPT = "Do you want to do research on this?";

export interface ResearchOffer {
  readonly question: string;
}

/** An imperative `research …` at the start of the line (after the optional polite lead), but not "research vault". */
const RESEARCH_VERB_RE = new RegExp(String.raw`^\s*${POLITE_LEAD}research(?!\s+vault)\b`, "i");

/** Explicit depth phrases, anywhere in the line. */
const DEPTH_PHRASE_RE =
  /\bdeep\s+dive\s+(?:on|into)\b|\bin[-\s]depth\b|\b(?:comprehensive|detailed|thorough)\s+(?:overview|analysis|breakdown|guide|report|comparison)\b|\bpros\s+and\s+cons\s+of\b|\b(?:write|give\s+me|put\s+together)\s+(?:me\s+)?a\s+report\s+on\b/i;

/** "give me a …" is Yoh's own addressee, not Spencer talking about himself, so it is dropped before the first-person check. */
const ADDRESSEE_RE = /\b(?:give|write|put\s+together)\s+me\b/gi;

/** The once-per-session key for an offered message: trimmed, lower-cased, whitespace collapsed. */
export function researchOfferKey(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseResearchOffer(line: string): ResearchOffer | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith("/") || /^search:/i.test(trimmed)) return undefined;
  if (PLANNING_NOUN_RE.test(trimmed)) return undefined;

  const verbMatch = RESEARCH_VERB_RE.exec(trimmed);
  if (verbMatch) {
    const stripped = (trimmed.slice(0, verbMatch.index) + trimmed.slice(verbMatch.index + verbMatch[0].length))
      .replace(/\s+/g, " ")
      .trim();
    return { question: stripped.length > 0 ? stripped : trimmed };
  }

  if (DEPTH_PHRASE_RE.test(trimmed) && !CUE_PATH_FIRST_PERSON_RE.test(trimmed.replace(ADDRESSEE_RE, " "))) {
    return { question: trimmed };
  }
  return undefined;
}
