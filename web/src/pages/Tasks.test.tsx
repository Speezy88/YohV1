/**
 * web/src/pages/Tasks.test.tsx — Task 6B (FR-43): the Tasks page.
 *
 * The server calls are mocked at the one RPC client (`apiClient.ts`), so
 * the page's real store, formatting, optimism and revert logic all run.
 * Covers: grouped rows with missing-field badges; quick-add focused on
 * arrival, chips before Enter, the row appearing at once, a failed create
 * reverting; an inline edit showing at once and reverting on failure; live
 * options in a select; ↑/↓ between rows and back to quick-add; `N`; the
 * grouping control; and check-off + Undo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import TasksPage from "./Tasks.tsx";
import { apiClient } from "../lib/apiClient.ts";
import * as notifications from "../lib/notifications.ts";
import type { TasksViewResponse } from "../../../src/types/api.ts";

vi.mock("../lib/apiClient.ts", () => ({
  apiClient: {
    api: {
      tasks: {
        $get: vi.fn(),
        $post: vi.fn(),
        parse: { $post: vi.fn() },
        ":id": { field: { $post: vi.fn() }, title: { $post: vi.fn() } },
      },
      "check-off": { $post: vi.fn(), ":id": { undo: { $post: vi.fn() }, hold: { $post: vi.fn() }, release: { $post: vi.fn() } } },
    },
  },
}));

type Mock = ReturnType<typeof vi.fn>;
const api = apiClient.api as unknown as {
  tasks: { $get: Mock; $post: Mock; parse: { $post: Mock }; ":id": { field: { $post: Mock }; title: { $post: Mock } } };
  "check-off": { $post: Mock; ":id": { undo: { $post: Mock } } };
};
const envelope = (body: unknown) => ({ json: async () => body });

const VIEW: TasksViewResponse = {
  today: "2026-09-27",
  groupBy: "due",
  query: "",
  total: 3,
  groups: [
    {
      key: "overdue",
      label: "Overdue",
      tone: "danger",
      tasks: [{ id: "t-over", title: "Email Mr. Alvarez", dueDate: "2026-09-25", estimatedDurationMinutes: 15, area: "School", energy: "low", status: "not-started", missing: [], overdue: true }],
    },
    {
      key: "today",
      label: "Today",
      tone: "accent",
      tasks: [{ id: "t-calc", title: "Calc problem set 4", dueDate: "2026-09-27", estimatedDurationMinutes: 60, area: "Math", energy: "medium", status: "not-started", missing: [], overdue: false }],
    },
    {
      key: "no-date",
      label: "No date",
      tone: "neutral",
      tasks: [{ id: "t-essay", title: "College essay brainstorm", area: "School", status: "not-started", missing: ["estimatedDurationMinutes", "dueDate", "energy"], overdue: false }],
    },
  ],
  options: {
    area: ["School", "Math", "Bio"],
    energy: [
      { value: "high", label: "Deep" },
      { value: "medium", label: "medium" },
      { value: "low", label: "low" },
    ],
    status: [
      { value: "not-started", label: "Nothing" },
      { value: "in-progress", label: "In Progress" },
      { value: "completed", label: "Completed" },
    ],
  },
};

async function renderLoaded(): Promise<void> {
  render(<TasksPage />);
  await screen.findByText("Calc problem set 4");
}

function row(title: string): HTMLElement {
  return screen.getByText(title).closest("li") as HTMLElement;
}

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.tasks.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    api.tasks.parse.$post.mockResolvedValue(envelope({ ok: true, value: { title: "", unmatchedAreas: [] } }));
    try {
      window.localStorage.clear();
    } catch {
      // storage unavailable: nothing to clear
    }
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Polish-2 (Spencer's live-app report: "I do not want to be able to
  // scroll pages while my cursor is in the tasks section"): the page root
  // carries the generic wheel-nav opt-out marker `lib/wheelNav.ts` reads.
  it("the page root opts out of wheel page-navigation (data-wheel-nav=\"off\")", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { name: "Tasks", level: 1 }).closest('[data-wheel-nav="off"]')).not.toBeNull();
  });

  it("renders the server's groups with counts, overdue dates in danger ink, and Add badges for missing fields", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { name: "Overdue · 1" })).toHaveClass("text-ink-danger");
    expect(screen.getByRole("heading", { name: "Today · 1" })).toHaveClass("text-ink-accent");
    const overdue = within(row("Email Mr. Alvarez")).getByRole("button", { name: /^Due for Email Mr. Alvarez: Fri, Sep 25$/ });
    expect(overdue.querySelector("span")).toHaveClass("text-ink-danger");
    const essay = row("College essay brainstorm");
    expect(within(essay).getByText("Add due date")).toBeInTheDocument();
    expect(within(essay).getByText("Add time")).toBeInTheDocument();
    expect(within(essay).getByText("Add energy")).toBeInTheDocument();
    expect(within(row("Calc problem set 4")).getByText("Medium")).toBeInTheDocument();
    expect(within(row("Calc problem set 4")).getByText("Nothing")).toBeInTheDocument();
  });

  it("focuses the quick-add line on arrival", async () => {
    await renderLoaded();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "New task" }));
  });

  it("shows what it reads as chips before Enter, then Enter adds the row at once and writes it", async () => {
    api.tasks.parse.$post.mockResolvedValue(
      envelope({ ok: true, value: { title: "Lab report", dueDate: "2026-10-02", estimatedDurationMinutes: 90, energy: "high", area: "Bio", unmatchedAreas: [] } }),
    );
    let resolveCreate: (v: unknown) => void = () => {};
    api.tasks.$post.mockImplementation(() => new Promise((r) => (resolveCreate = r)));
    await renderLoaded();
    const input = screen.getByRole("textbox", { name: "New task" });
    fireEvent.change(input, { target: { value: "Lab report due fri 90m high #bio" } });
    await waitFor(() => expect(screen.getAllByTestId("quick-add-chip").map((c) => c.textContent)).toEqual(["Due Fri, Oct 2", "90 min", "Deep energy", "Area: Bio"]));
    expect(api.tasks.parse.$post).toHaveBeenCalledWith({ json: { text: "Lab report due fri 90m high #bio", areaOptions: ["School", "Math", "Bio"] } });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.tasks.$post).toHaveBeenCalledWith({ json: { text: "Lab report due fri 90m high #bio" } });
    expect(input).toHaveValue("");
    const added = row("Lab report");
    expect(screen.getByRole("heading", { name: "Just added · 1" })).toBeInTheDocument();
    expect(within(added).getByText("90 min")).toBeInTheDocument();
    expect(added).toHaveAttribute("aria-busy", "true");

    await act(async () =>
      resolveCreate(
        envelope({
          ok: true,
          value: {
            task: { id: "created-1", title: "Lab report", dueDate: "2026-10-02", estimatedDurationMinutes: 90, energy: "high", area: "Bio", missing: [], overdue: false },
            receipt: 'Added "Lab report" to Tasks.',
          },
        }),
      ),
    );
    await waitFor(() => expect(api.tasks.$get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status", { hidden: false }).textContent).toBe('Added "Lab report" to Tasks.');
  });

  it("a failed create takes the row back out and shows a plain failure notice", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice");
    api.tasks.$post.mockResolvedValue(envelope({ ok: false, error: { kind: "unreachable", message: "I couldn't reach Notion right now; nothing was changed." } }));
    await renderLoaded();
    const input = screen.getByRole("textbox", { name: "New task" });
    fireEvent.change(input, { target: { value: "Call the dentist" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Couldn\'t add "Call the dentist". I couldn\'t reach Notion right now; nothing was changed.'));
    expect(screen.queryByText("Call the dentist")).not.toBeInTheDocument();
  });

  it("an inline Duration edit shows at once, writes through the field route, and reverts on failure", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice");
    let resolveWrite: (v: unknown) => void = () => {};
    api.tasks[":id"].field.$post.mockImplementation(() => new Promise((r) => (resolveWrite = r)));
    await renderLoaded();
    fireEvent.click(within(row("Calc problem set 4")).getByRole("button", { name: /^Duration for Calc problem set 4/ }));
    const editor = screen.getByRole("spinbutton", { name: "Duration for Calc problem set 4" });
    expect(document.activeElement).toBe(editor);
    fireEvent.change(editor, { target: { value: "45" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(api.tasks[":id"].field.$post).toHaveBeenCalledWith({ param: { id: "t-calc" }, json: { field: "estimatedDurationMinutes", value: "45" } });
    expect(within(row("Calc problem set 4")).getByText("45 min")).toBeInTheDocument();
    await act(async () => resolveWrite(envelope({ ok: false, error: { kind: "unreachable", message: "I couldn't reach Notion right now; nothing was changed." } })));
    expect(within(row("Calc problem set 4")).getByText("60 min")).toBeInTheDocument();
    expect(notice).toHaveBeenCalledWith('Couldn\'t change the duration for "Calc problem set 4". I couldn\'t reach Notion right now; nothing was changed.');
  });

  it("a Duration preset commits in one click", async () => {
    api.tasks[":id"].field.$post.mockResolvedValue(envelope({ ok: true, value: { receipt: "Estimated Duration set to 90 min." } }));
    await renderLoaded();
    fireEvent.click(within(row("College essay brainstorm")).getByRole("button", { name: /^Duration for College essay brainstorm/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Duration presets" })).getByRole("button", { name: "90" }));
    expect(api.tasks[":id"].field.$post).toHaveBeenCalledWith({ param: { id: "t-essay" }, json: { field: "estimatedDurationMinutes", value: "90" } });
  });

  it("Esc cancels an edit, writes nothing, and puts focus back on the cell", async () => {
    await renderLoaded();
    const cell = within(row("Calc problem set 4")).getByRole("button", { name: /^Due for Calc problem set 4/ });
    fireEvent.click(cell);
    const editor = screen.getByLabelText("Due for Calc problem set 4");
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(api.tasks[":id"].field.$post).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(row("Calc problem set 4")).getByRole("button", { name: /^Due for Calc problem set 4/ }));
  });

  it("Energy and Area edit with selects fed from the live Notion options", async () => {
    api.tasks[":id"].field.$post.mockResolvedValue(envelope({ ok: true, value: { receipt: "Energy set to high." } }));
    await renderLoaded();
    fireEvent.click(within(row("Calc problem set 4")).getByRole("button", { name: /^Energy for Calc problem set 4/ }));
    const select = screen.getByRole("combobox", { name: "Energy for Calc problem set 4" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Deep", "Medium", "Low"]);
    fireEvent.change(select, { target: { value: "high" } });
    expect(api.tasks[":id"].field.$post).toHaveBeenCalledWith({ param: { id: "t-calc" }, json: { field: "energy", value: "high" } });
    expect(within(row("Calc problem set 4")).getByText("Deep")).toBeInTheDocument();

    fireEvent.click(within(row("Calc problem set 4")).getByRole("button", { name: /^Area for Calc problem set 4/ }));
    const area = screen.getByRole("combobox", { name: "Area for Calc problem set 4" });
    expect(within(area).getAllByRole("option").map((o) => o.textContent)).toEqual(["School", "Math", "Bio"]);
  });

  it("↓ from quick-add enters the list, ↓/↑ move between rows in the same column, ↑ from the first row returns to quick-add", async () => {
    await renderLoaded();
    const input = screen.getByRole("textbox", { name: "New task" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(row("Email Mr. Alvarez")).getByRole("checkbox"));
    const due = within(row("Email Mr. Alvarez")).getByRole("button", { name: /^Due for/ });
    due.focus();
    fireEvent.keyDown(due, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(row("Calc problem set 4")).getByRole("button", { name: /^Due for/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(input);
  });

  it("N focuses quick-add from anywhere on the page (not while typing in a field)", async () => {
    await renderLoaded();
    const checkbox = within(row("Calc problem set 4")).getByRole("checkbox");
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: "n" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "New task" }));
  });

  it("the grouping control refetches with the new grouping and remembers it", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    await waitFor(() => expect(api.tasks.$get).toHaveBeenLastCalledWith({ query: { groupBy: "area" } }));
    expect(screen.getByRole("button", { name: "Area" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("yoh.tasks.groupBy")).toBe("area");
  });

  it("search is sent to the server after a short pause", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "calc" } });
    await waitFor(() => expect(api.tasks.$get).toHaveBeenLastCalledWith({ query: { groupBy: "due", query: "calc" } }));
  });

  it("checking a box uses check-off + Undo; the row stays listed, checked", async () => {
    api["check-off"].$post.mockResolvedValue(
      envelope({ ok: true, value: { id: "p1", taskId: "t-calc", commitAt: "2026-09-27T18:00:05.000Z", asOf: "2026-09-27T18:00:00.000Z", held: false } }),
    );
    api["check-off"][":id"].undo.$post.mockResolvedValue(envelope({ ok: true, value: { id: "p1" } }));
    await renderLoaded();
    fireEvent.click(within(row("Calc problem set 4")).getByRole("checkbox"));
    expect(within(row("Calc problem set 4")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(api["check-off"].$post).toHaveBeenCalledWith({ json: { taskId: "t-calc" } });
    const toast = await screen.findByTestId("undo-toast");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(within(row("Calc problem set 4")).getByRole("checkbox")).toHaveAttribute("aria-checked", "false"));
  });

  it("choosing Completed in the Status select takes the check-off path (Undo toast), never a direct Status write", async () => {
    api["check-off"].$post.mockResolvedValue(
      envelope({ ok: true, value: { id: "p2", taskId: "t-calc", commitAt: "2026-09-27T18:00:05.000Z", asOf: "2026-09-27T18:00:00.000Z", held: false } }),
    );
    await renderLoaded();
    fireEvent.click(within(row("Calc problem set 4")).getByRole("button", { name: /^Status for Calc problem set 4/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status for Calc problem set 4" }), { target: { value: "completed" } });
    await waitFor(() => expect(api["check-off"].$post).toHaveBeenCalledWith({ json: { taskId: "t-calc" } }));
    expect(api.tasks[":id"].field.$post).not.toHaveBeenCalled();
    expect(within(row("Calc problem set 4")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByTestId("undo-toast")).toHaveTextContent("Checked off Calc problem set 4");
  });

  it("other Status changes stay direct field writes", async () => {
    api.tasks[":id"].field.$post.mockResolvedValue(envelope({ ok: true, value: { receipt: "Status set to In Progress." } }));
    await renderLoaded();
    fireEvent.click(within(row("Calc problem set 4")).getByRole("button", { name: /^Status for Calc problem set 4/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status for Calc problem set 4" }), { target: { value: "in-progress" } });
    expect(api.tasks[":id"].field.$post).toHaveBeenCalledWith({ param: { id: "t-calc" }, json: { field: "status", value: "in-progress" } });
    expect(api["check-off"].$post).not.toHaveBeenCalled();
  });

  it("the title renames in place: click, type, Enter saves and shows at once", async () => {
    api.tasks[":id"].title.$post.mockResolvedValue(envelope({ ok: true, value: { receipt: 'Renamed to "Calc problem set 5".' } }));
    await renderLoaded();
    fireEvent.click(within(row("Calc problem set 4")).getByRole("button", { name: "Title: Calc problem set 4" }));
    const editor = screen.getByRole("textbox", { name: "Title of Calc problem set 4" });
    expect(document.activeElement).toBe(editor);
    fireEvent.change(editor, { target: { value: "Calc problem set 5" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(api.tasks[":id"].title.$post).toHaveBeenCalledWith({ param: { id: "t-calc" }, json: { title: "Calc problem set 5" } });
    expect(screen.getByRole("button", { name: "Title: Calc problem set 5" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe('Renamed to "Calc problem set 5".'));
  });

  it("Esc cancels a rename; a failed rename reverts honestly with a notice", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice");
    api.tasks[":id"].title.$post.mockResolvedValue(envelope({ ok: false, error: { kind: "unreachable", message: "I couldn't reach Notion right now; nothing was changed." } }));
    await renderLoaded();
    fireEvent.click(within(row("Calc problem set 4")).getByRole("button", { name: "Title: Calc problem set 4" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Title of Calc problem set 4" }), { key: "Escape" });
    expect(api.tasks[":id"].title.$post).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Title: Calc problem set 4" }));

    fireEvent.click(screen.getByRole("button", { name: "Title: Calc problem set 4" }));
    const editor = screen.getByRole("textbox", { name: "Title of Calc problem set 4" });
    fireEvent.change(editor, { target: { value: "Renamed" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Title: Calc problem set 4" })).toBeInTheDocument());
    expect(notice).toHaveBeenCalledWith('Couldn\'t change the title for "Calc problem set 4". I couldn\'t reach Notion right now; nothing was changed.');
  });

  it("while loading, skeleton rows — never a spinner — and the quick-add is already usable", () => {
    api.tasks.$get.mockImplementation(() => new Promise(() => {}));
    render(<TasksPage />);
    expect(screen.getAllByTestId("task-row-skeleton").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "New task" })).toBeEnabled();
  });
});
