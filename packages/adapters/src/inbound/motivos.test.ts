import { describe, expect, it } from "vitest";
import { clampReason, MAX_REASON_CHARS } from "./motivo";
import { getonboardParser } from "./getonboard";
import type { InboundEmailContent } from "./parsers";

/** Los motivos de error de los parsers nunca copian texto del email sin tope. */
const email = (html: string): InboundEmailContent => ({
  from: "Get on Board <no-reply@getonbrd.com>",
  to: ["u_a0000000@ingest.example.com"],
  subject: "Revisa nuestra selección de empleos",
  html,
  text: null,
  receivedAt: new Date("2026-09-20T02:12:42Z"),
});

const trk = (slug: string) =>
  `https://trk0000.r.us-east-1.awstrack.me/L0/https:%2F%2Fwww.getonbrd.com%2Fempleos%2Fprogramacion%2F${slug}%3Futm_content=${slug}/1/0/A=473`;

const tarjeta = (slug: string, meta: string) => `<div class="job"><table><tr>
<td><a style="display:block" href="${trk(slug)}"><strong>Puesto Demo</strong>
<span>
${meta}
</span>
<br>
<span style="font-size:11px">
<strong>Empresa Demo</strong>
<br>
</span>
</a></td>
</tr></table></div>`;

const lista = (card: string) =>
  `<div class="content"><div class="gb-results-list">${card}</div></div>`;

describe("motivos de error de los parsers", () => {
  it("una línea de 300 KB en el contrato deja un motivo de 120 caracteres como máximo", () => {
    const out = getonboardParser.parse(email(lista(tarjeta("puesto-demo", "x".repeat(300_000)))));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(out.reason).not.toContain("xxxxxxxxxx");
  });

  it("una línea de seniority larga deja un motivo acotado", () => {
    const out = getonboardParser.parse(
      email(lista(tarjeta("puesto-demo", `${"y".repeat(300_000)} | Full time`))),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  });

  it("un slug enorme tampoco entra completo en el motivo", () => {
    const out = getonboardParser.parse(email(lista(tarjeta("s".repeat(200_000), "desconocido"))));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  });

  it("un motivo corto queda igual", () => {
    expect(clampReason("email sin HTML: cola manual")).toBe("email sin HTML: cola manual");
  });

  it("clampReason recorta y marca el corte, sin pasar el máximo", () => {
    const out = clampReason("z".repeat(1_000_000));
    expect(out.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });
});
