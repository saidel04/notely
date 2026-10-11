import { describe, expect, it } from "vitest";
import { applyTemplate, DAILY_TEMPLATE, isoDate, noteNameFor, STARTER_TEMPLATES } from "./templates";

const now = new Date(2026, 9, 4, 9, 5); // Sunday 4 October 2026, 09:05

describe("applyTemplate", () => {
  it("fills placeholders (any case, optional spaces) and keeps unknown ones", () => {
    const r = applyTemplate("# {{title}} in {{ Notebook }}\n{{date}} {{time}} {{weekday}} {{longdate}} {{nope}}", {
      title: "Cells",
      notebook: "Biology",
      now,
    });
    expect(r.text).toBe("# Cells in Biology\n2026-10-04 09:05 Sunday 4 October 2026 {{nope}}");
    expect(r.cursor).toBeNull();
  });

  it("removes {{cursor}} and reports where it was", () => {
    const r = applyTemplate("# {{title}}\n\n- {{cursor}}\n", { title: "A", notebook: "N", now });
    expect(r.text).toBe("# A\n\n- \n");
    expect(r.cursor).toBe("# A\n\n- ".length);
  });

  it("works for every starter template", () => {
    for (const t of Object.values(STARTER_TEMPLATES)) {
      const r = applyTemplate(t, { title: "T", notebook: "N", now });
      expect(r.text).not.toMatch(/\{\{/);
      expect(r.cursor).not.toBeNull();
    }
  });
});

describe("names", () => {
  it("names daily notes by date and others by template + date", () => {
    expect(isoDate(now)).toBe("2026-10-04");
    expect(noteNameFor(DAILY_TEMPLATE, now)).toBe("2026-10-04");
    expect(noteNameFor("Lecture notes", now)).toBe("Lecture notes 2026-10-04");
  });
});
