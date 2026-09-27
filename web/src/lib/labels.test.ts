import { describe, it, expect } from "vitest";
import { displayLabel } from "./labels.ts";

describe("displayLabel", () => {
  it("returns a normal label unchanged", () => {
    expect(displayLabel("Lab report draft")).toBe("Lab report draft");
  });

  it("shows (No title) for an empty string", () => {
    expect(displayLabel("")).toBe("(No title)");
  });

  it("shows (No title) for whitespace only", () => {
    expect(displayLabel("   ")).toBe("(No title)");
  });

  it("shows (No title) for punctuation only", () => {
    expect(displayLabel("...")).toBe("(No title)");
    expect(displayLabel("-")).toBe("(No title)");
    expect(displayLabel("!!")).toBe("(No title)");
  });

  it("keeps a label that has real text alongside punctuation", () => {
    expect(displayLabel("- Draft the memo -")).toBe("- Draft the memo -");
  });
});
