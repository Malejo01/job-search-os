import { MAX_EMAIL_HTML_CHARS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { bumeranParser } from "./bumeran";
import { computrabajoParser } from "./computrabajo";
import { getonboardParser } from "./getonboard";
import { indeedParser } from "./indeed";
import { linkedinParser } from "./linkedin";
import type { EmailParser } from "./parsers";

const MB2 = 2 * 1024 * 1024;
const JUST_UNDER = MAX_EMAIL_HTML_CHARS - 1024;
/** Las máquinas del CI son más lentas y compartidas: el margen evita falsos rojos. */
const CI_FACTOR = process.env.CI ? 4 : 1;

const email = (html: string) => ({
  from: "alertas@example.com",
  to: [],
  subject: null,
  html,
  text: null,
  receivedAt: new Date(0),
});

function repeated(unit: string, size: number, head = ""): string {
  return head + unit.repeat(Math.floor((size - head.length) / unit.length));
}

function elapsed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

const PARSERS: EmailParser[] = [
  bumeranParser,
  computrabajoParser,
  getonboardParser,
  indeedParser,
  linkedinParser,
];
const BUMERAN_HEAD = "<title>Bumeran te sugiere</title>";

const UNITS: [string, string][] = [
  ["aperturas", "<"],
  ["<a sin cierre", "<a "],
  ["<a > sin cierre", "<a >"],
  ["<h1 sin cierre", "<h1>"],
  ["<h2 sin cierre", "<h2><a>"],
  ["<h3 sin cierre", "<h3 "],
  ["<p sin cierre", "<p>"],
  ["<td sin cierre", '<td class="title_oferta">'],
  ["<span sin cierre", "<span>"],
  ["<strong sin cierre", "<strong>"],
  ["comillas angulares", "«"],
  ["tarjetas de LinkedIn", 'data-test-id="job-card"><a href="/jobs/view/1">'],
  ["tarjetas de Get on Board", '<div class="job"><strong>'],
  ["listitem", 'role="listitem">'],
];

describe.each(PARSERS.map((p) => [p.name, p] as const))("%s", (_, parser) => {
  it("falla cerrado arriba del tope", () => {
    const result = parser.parse(email("x".repeat(MAX_EMAIL_HTML_CHARS + 1)));

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("cola manual") });
  });

  it.each(UNITS)("2 MB de %s vuelven en menos de 100 ms", (_, unit) => {
    expect(elapsed(() => parser.parse(email(repeated(unit, MB2))))).toBeLessThan(100 * CI_FACTOR);
  });

  it.each(UNITS)("justo debajo del tope, %s no se cuelga", (_, unit) => {
    const html = repeated(unit, JUST_UNDER, parser.name === "bumeran" ? BUMERAN_HEAD : "");

    expect(elapsed(() => parser.parse(email(html)))).toBeLessThan(1_500 * CI_FACTOR);
  });
});
