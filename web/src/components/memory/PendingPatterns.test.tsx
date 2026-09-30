import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OpenItemQuestion } from "../../../../src/types/api.ts";
import { PendingPatterns } from "./PendingPatterns.tsx";

const q = (over: Partial<OpenItemQuestion> = {}): OpenItemQuestion => ({
  requestId: "r1", questionId: "q1", text: "Add a pattern: Errands run long?", options: [{ label: "Yes", value: "yes" }], allowsFreeText: false,
  proposal: { id: "p1", kind: "learned-pattern", entityId: "e", entityVersion: "1", suggested: { evidence: "5 times since Sep 3" }, reason: "fallback reason", createdAt: "2026-09-29T10:00:00Z" },
  ...over,
});

describe("PendingPatterns", () => {
  it("shows the question text and its evidence caption, with no buttons", () => {
    render(<ul><PendingPatterns questions={[q()]} /></ul>);
    expect(screen.getByText("Add a pattern: Errands run long?")).toBeInTheDocument();
    expect(screen.getByText("5 times since Sep 3")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("falls back to the proposal reason when the suggestion has no evidence line", () => {
    render(<ul><PendingPatterns questions={[q({ proposal: { ...q().proposal!, suggested: { padding: 10 } } })]} /></ul>);
    expect(screen.getByText("fallback reason")).toBeInTheDocument();
  });
});
