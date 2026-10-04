/**
 * The Research Vault property set for one researched answer (E11-R15). One builder, used by
 * "save that" and by the background research runner.
 */
export function researchVaultProperties(input: {
  readonly query: string;
  readonly answer: string;
  readonly citations: readonly string[];
  readonly searchDate: string;
}): Record<string, string> {
  return {
    title: input.query,
    keyFindings: input.answer,
    query: input.query,
    searchDate: input.searchDate,
    sources: input.citations.join("\n"),
  };
}

/** The question as it reads in a notification title: cut to 80 characters with an ellipsis (E11-R12). */
export function researchTopic(question: string): string {
  const text = question.trim();
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}
