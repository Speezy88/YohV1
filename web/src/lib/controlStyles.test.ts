import { describe, it, expect } from "vitest";
import * as styles from "./controlStyles.ts";

const BUTTONS = {
  BUTTON_PRIMARY: styles.BUTTON_PRIMARY,
  BUTTON_SECONDARY: styles.BUTTON_SECONDARY,
  BUTTON_TEXT: styles.BUTTON_TEXT,
  ICON_BUTTON: styles.ICON_BUTTON,
};

describe("controlStyles", () => {
  for (const [name, value] of Object.entries(BUTTONS)) {
    it(`${name} includes the focus ring, transition and disabled treatment`, () => {
      expect(value).toContain(styles.FOCUS_RING);
      expect(value).toContain(styles.CONTROL_TRANSITION);
      expect(value).toContain(styles.CONTROL_DISABLED);
    });
  }

  it("no exported constant uses transition-all", () => {
    for (const value of Object.values(styles)) expect(value).not.toContain("transition-all");
  });

  it("the transition covers only paint properties via the control tokens", () => {
    expect(styles.CONTROL_TRANSITION).toContain("duration-(--duration-control)");
    expect(styles.CONTROL_TRANSITION).toContain("ease-(--ease-control)");
  });

  it("disabled is opacity-50 with not-allowed cursor", () => {
    expect(styles.CONTROL_DISABLED).toContain("disabled:opacity-50");
    expect(styles.CONTROL_DISABLED).toContain("disabled:cursor-not-allowed");
  });

  it("sizes are 36 / 44 / 48px", () => {
    expect(styles.CONTROL_SM).toContain("h-9");
    expect(styles.CONTROL_MD).toContain("h-11");
    expect(styles.CONTROL_LG).toContain("h-12");
  });

  it("primary lifts on hover and dims on press; secondary steps the shadow", () => {
    expect(styles.BUTTON_PRIMARY).toContain("hover:brightness-105");
    expect(styles.BUTTON_PRIMARY).toContain("active:brightness-95");
    expect(styles.BUTTON_SECONDARY).toContain("hover:shadow-extruded-md");
    expect(styles.BUTTON_SECONDARY).toContain("active:shadow-inset");
    expect(styles.BUTTON_TEXT).toContain("hover:underline");
  });

  it("row hovers", () => {
    expect(styles.ROW_HOVER_FLAT).toContain("hover:bg-surface-sunken");
    expect(styles.ROW_HOVER_RAISED).toContain("hover:shadow-extruded-md");
  });
});
