// Note templates: Markdown files in the vault's `_templates/` folder, with
// placeholders filled in when a note is created from them. Pure helpers only.

export const DAILY_TEMPLATE = "Daily note";

/**
 * Starter templates, written the first time templates are used. (No `# {{title}}`
 * heading: Notely shows the note's name as its title already.)
 */
export const STARTER_TEMPLATES: Record<string, string> = {
  "Lecture notes": `**Course:**
**Date:** {{date}} ({{weekday}})

## Key ideas

- {{cursor}}

## Details


## Questions to follow up


## Summary

`,
  "Reading notes": `**Source:** [[]]
**Read on:** {{date}}

## Main argument

{{cursor}}

## Key passages

>

## My thoughts


## Links

`,
  [DAILY_TEMPLATE]: `# {{weekday}}, {{longdate}}

## Today

- [ ] {{cursor}}

## Notes


## Studied

`,
};

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-04" (local date) — also the name of that day's daily note. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface TemplateVars {
  title: string;
  notebook: string;
  now: Date;
}

/**
 * Fills a template: {{title}}, {{date}}, {{time}}, {{weekday}}, {{longdate}},
 * {{notebook}}; {{cursor}} marks where the cursor starts. Unknown placeholders
 * are left as they are.
 */
export function applyTemplate(template: string, vars: TemplateVars): { text: string; cursor: number | null } {
  const d = vars.now;
  const values: Record<string, string> = {
    title: vars.title,
    notebook: vars.notebook,
    date: isoDate(d),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    weekday: WEEKDAYS[d.getDay()],
    longdate: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  };
  const filled = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key.toLowerCase() === "cursor" ? m : (values[key.toLowerCase()] ?? m)));
  const at = filled.search(/\{\{\s*cursor\s*\}\}/i);
  if (at === -1) return { text: filled, cursor: null };
  const text = filled.replace(/\{\{\s*cursor\s*\}\}/gi, "");
  return { text, cursor: at };
}

/** A starting name for a note made from a template: "Lecture notes 2026-10-04". */
export function noteNameFor(template: string, now: Date) {
  return template === DAILY_TEMPLATE ? isoDate(now) : `${template} ${isoDate(now)}`;
}
