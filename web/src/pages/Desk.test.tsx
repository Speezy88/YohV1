import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DeskPage from "./Desk.tsx";

describe("DeskPage", () => {
  it("says Desk isn't built yet, with no epic reference", () => {
    render(<DeskPage />);
    expect(screen.getByRole("heading", { name: "Desk" })).toBeInTheDocument();
    expect(screen.getByText("Desk isn't built yet.")).toBeInTheDocument();
    expect(screen.queryByText(/epic/i)).not.toBeInTheDocument();
  });
});
