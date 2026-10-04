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
