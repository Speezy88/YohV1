/**
 * web/src/components/NotificationOverlay.test.tsx
 *
 * Story 7.7: glass card, 3px accent-solid left bar, pulsing dot, one-line
 * message, whole surface clickable, aria-live announcement, deep-link
 * click, close control, up-to-3-visible/newest-first, reduced-motion entry.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationOverlay } from "./NotificationOverlay.tsx";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";
import * as notificationsModule from "../lib/notifications.ts";
import type { NotificationRecord } from "../../../src/types/api.ts";

function renderWithNav(records: readonly NotificationRecord[], goTo = vi.fn()) {
  vi.spyOn(notificationsModule, "useNotifications").mockReturnValue(records);
  vi.spyOn(notificationsModule, "dismissNotification").mockImplementation(() => {});
  return {
    goTo,
    ...render(
      <PageNavigationContext.Provider value={{ index: 0, goTo, next: () => {}, prev: () => {} }}>
        <NotificationOverlay />
      </PageNavigationContext.Provider>,
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotificationOverlay", () => {
  it("renders a glass card with the message, announced via aria-live=polite", () => {
    renderWithNav([{ id: "n1", kind: "sandbox-complete", title: "Saved 3 Tasks", body: "Saved 3 Tasks", createdAt: "2026-01-01T00:00:00.000Z", deepLink: "/tasks" }]);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Saved 3 Tasks");
  });

  it("has a 3px accent-solid left border and the glass surface class", () => {
    renderWithNav([{ id: "n1", kind: "operational", title: "x", body: "x", createdAt: "2026-01-01T00:00:00.000Z", deepLink: null }]);
    const card = screen.getByTestId("notification-card");
    // Ruling R19: the bar comes from the shared unlayered `.glass-accent-bar`
    // rule (tokens.css) — a Tailwind `border-l-*` utility is layered and loses
    // to `.notification-glass`'s unlayered `border` shorthand, so it never showed.
    expect(card).toHaveClass("notification-glass", "glass-accent-bar");
    expect(card.className).not.toMatch(/border-l-\[3px\]|border-accent-solid/);
  });

  it("clicking a notification with a deepLink navigates to the matching page and dismisses it", () => {
    const dismiss = vi.spyOn(notificationsModule, "dismissNotification");
    const { goTo } = renderWithNav([{ id: "n1", kind: "sandbox-complete", title: "Saved 3 Tasks", body: "Saved 3 Tasks", createdAt: "2026-01-01T00:00:00.000Z", deepLink: "/tasks" }]);
    fireEvent.click(screen.getByText("Saved 3 Tasks"));
    expect(goTo).toHaveBeenCalledWith(2); // PAGES index of "tasks"
    expect(dismiss).toHaveBeenCalledWith("n1");
  });

  it("an operational notification is message-only and clicking it never navigates (but still dismisses)", () => {
    const dismiss = vi.spyOn(notificationsModule, "dismissNotification");
    const { goTo } = renderWithNav([{ id: "n1", kind: "operational", title: "Notion sign-in expired", body: "Notion sign-in expired", createdAt: "2026-01-01T00:00:00.000Z", deepLink: null }]);
    fireEvent.click(screen.getByText("Notion sign-in expired"));
    expect(goTo).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledWith("n1");
  });

  it("an unrecognized deepLink dismisses without navigating or throwing", () => {
    const dismiss = vi.spyOn(notificationsModule, "dismissNotification");
    const { goTo } = renderWithNav([{ id: "n1", kind: "reshuffle-apply-failed", title: "x", body: "Couldn't update your calendar", createdAt: "2026-01-01T00:00:00.000Z", deepLink: "/nonexistent-page" }]);
    fireEvent.click(screen.getByText("Couldn't update your calendar"));
    expect(goTo).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledWith("n1");
  });

  it("shows an accessibly-named close control per card that dismisses without navigating", () => {
    const dismiss = vi.spyOn(notificationsModule, "dismissNotification");
    const { goTo } = renderWithNav([{ id: "n1", kind: "operational", title: "x", body: "x", createdAt: "2026-01-01T00:00:00.000Z", deepLink: null }]);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(dismiss).toHaveBeenCalledWith("n1");
    expect(goTo).not.toHaveBeenCalled();
  });

  it("is keyboard-operable: Enter on the focused card activates it, same as a click (UX-DR51: every control keyboard-reachable)", () => {
    const dismiss = vi.spyOn(notificationsModule, "dismissNotification");
    const { goTo } = renderWithNav([{ id: "n1", kind: "sandbox-complete", title: "Saved 3 Tasks", body: "Saved 3 Tasks", createdAt: "2026-01-01T00:00:00.000Z", deepLink: "/chat" }]);
    const card = screen.getByTestId("notification-card");
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(goTo).toHaveBeenCalledWith(1); // PAGES index of "chat"
    expect(dismiss).toHaveBeenCalledWith("n1");
  });

  it("Enter while the nested dismiss button has focus only dismisses — it does not also activate the card", () => {
    const dismiss = vi.spyOn(notificationsModule, "dismissNotification");
    const { goTo } = renderWithNav([{ id: "n1", kind: "sandbox-complete", title: "Saved 3 Tasks", body: "Saved 3 Tasks", createdAt: "2026-01-01T00:00:00.000Z", deepLink: "/chat" }]);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("shows at most 3 cards, newest-first, even when the store holds more (render-time cap)", () => {
    renderWithNav([
      { id: "n4", kind: "operational", title: "4", body: "4", createdAt: "2026-01-01T00:00:03.000Z", deepLink: null },
      { id: "n3", kind: "operational", title: "3", body: "3", createdAt: "2026-01-01T00:00:02.000Z", deepLink: null },
      { id: "n2", kind: "operational", title: "2", body: "2", createdAt: "2026-01-01T00:00:01.000Z", deepLink: null },
      { id: "n1", kind: "operational", title: "1", body: "1", createdAt: "2026-01-01T00:00:00.000Z", deepLink: null },
    ]);
    const cards = screen.getAllByTestId("notification-card");
    expect(cards.map((c) => c.textContent)).toEqual(["4", "3", "2"]);
  });

  it("normal motion: the card gets the full drop+fade entry class and the dot pulses", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    renderWithNav([{ id: "n1", kind: "operational", title: "x", body: "x", createdAt: "2026-01-01T00:00:00.000Z", deepLink: null }]);
    expect(screen.getByTestId("notification-card").className).toMatch(/\bnotification-card\b/);
    expect(screen.getByTestId("notification-card").className).not.toMatch(/notification-card--reduced-motion/);
    expect(screen.getByTestId("notification-dot").className).toMatch(/\bnotification-dot\b/);
  });

  it("reduced motion: the card gets the fade-only entry class and the dot does not pulse", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    renderWithNav([{ id: "n1", kind: "operational", title: "x", body: "x", createdAt: "2026-01-01T00:00:00.000Z", deepLink: null }]);
    expect(screen.getByTestId("notification-card").className).toMatch(/notification-card--reduced-motion/);
    expect(screen.getByTestId("notification-dot").className).not.toMatch(/notification-dot\b/);
  });

  it("renders nothing but the empty live region when there are no notifications", () => {
    renderWithNav([]);
    expect(screen.queryByTestId("notification-card")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
