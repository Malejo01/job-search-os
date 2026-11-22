import { describe, expect, it } from "vitest";
import { cleanEvent, eventRecipients } from "./handle";
import { jobKeyFromTracker } from "./indeed";
import { linkedinParser } from "./linkedin";
import type { ResendReceivedEvent } from "./resend";

const MB2 = 2 * 1024 * 1024;
/** Las máquinas del CI son más lentas y compartidas: el margen evita falsos rojos. */
const CI_FACTOR = process.env.CI ? 4 : 1;

function elapsed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

const repeated = (unit: string, size: number) => unit.repeat(Math.floor(size / unit.length));

describe("jobKeyFromTracker · entrada hostil", () => {
  it("2 MB de una URL repetida vuelven en menos de 100 ms y sin clave", () => {
    const href = repeated("https://indeed.com/", MB2);
    let out: unknown = "sin correr";
    expect(elapsed(() => (out = jobKeyFromTracker(href)))).toBeLessThan(100 * CI_FACTOR);
    expect(out).toBeNull();
  });

  it("un link de más de 8 KB falla cerrado aunque traiga un jk válido", () => {
    const href = `https://indeed.com/rc/clk?x=${"a".repeat(9 * 1024)}&jk=0000abcdef012345`;
    expect(jobKeyFromTracker(href)).toBeNull();
  });

  it("un link directo normal sigue dando host y jk", () => {
    expect(jobKeyFromTracker("https://ar.indeed.com/rc/clk?jk=0000abcdef012345")).toEqual({
      host: "ar.indeed.com",
      jk: "0000abcdef012345",
    });
  });
});

describe("linkedinParser · asunto hostil", () => {
  it("un asunto de 2 MB con comillas angulares sin cerrar vuelve en menos de 100 ms", () => {
    const subject = repeated("«", MB2);
    const email = {
      from: "alertas@linkedin.com",
      to: [],
      subject,
      html: "<p>hola</p>",
      text: null,
      receivedAt: new Date(0),
    };
    expect(elapsed(() => linkedinParser.parse(email))).toBeLessThan(100 * CI_FACTOR);
  });
});

describe("eventRecipients · destinatarios hostiles", () => {
  it("2 MB de destinatarios con comillas angulares sin cerrar vuelven en menos de 100 ms", () => {
    // 100 destinatarios por lista y 1000 caracteres cada uno: el tope de entrada ya recorta el resto
    const hostile = Array.from({ length: 100 }, () => repeated("<", 1_000));
    const raw: ResendReceivedEvent = {
      type: "email.received",
      created_at: "2026-09-11T20:00:00.000Z",
      data: {
        email_id: "em_tiempo_destinatarios",
        from: "a@example.com",
        to: hostile,
        cc: hostile,
        bcc: hostile,
        received_for: hostile,
        attachments: [],
      },
    };
    let out: string[] = [];
    expect(
      elapsed(() => {
        out = eventRecipients(cleanEvent(raw));
      }),
    ).toBeLessThan(100 * CI_FACTOR);
    expect(out).toHaveLength(300);
  });

  it("un destinatario normal sigue dando su dirección en minúsculas", () => {
    const raw: ResendReceivedEvent = {
      type: "email.received",
      created_at: "2026-09-11T20:00:00.000Z",
      data: {
        email_id: "em_dest_normal",
        from: "a@example.com",
        to: ["Persona A <U_abc@Ingest.example>", " plano@ingest.example "],
        cc: [],
        bcc: [],
        received_for: ["<u_xyz@ingest.example>"],
        attachments: [],
      },
    };
    expect(eventRecipients(raw)).toEqual([
      "u_xyz@ingest.example",
      "u_abc@ingest.example",
      "plano@ingest.example",
    ]);
  });
});

describe("cleanEvent · encabezados hostiles", () => {
  const event = (over: Partial<ResendReceivedEvent["data"]>): ResendReceivedEvent => ({
    type: "email.received",
    created_at: "2026-09-11T20:00:00.000Z",
    data: {
      email_id: "em_tiempo",
      from: "Aviso <aviso@example.com>",
      to: ["u_a0000000@ingest.example"],
      cc: [],
      bcc: [],
      received_for: [],
      subject: "Hola",
      attachments: [],
      ...over,
    },
  });

  it("un asunto de 2 MB queda recortado", () => {
    const out = cleanEvent(event({ subject: "x".repeat(MB2) }));
    expect(out.data.subject?.length).toBeLessThanOrEqual(1_000);
  });

  it("un destinatario de 2 MB se recorta y se procesa en menos de 100 ms", () => {
    const hostile = repeated("<", MB2);
    let out: ResendReceivedEvent | null = null;
    expect(
      elapsed(() => (out = cleanEvent(event({ to: [hostile], received_for: [hostile] })))),
    ).toBeLessThan(100 * CI_FACTOR);
    expect(out!.data.to[0]!.length).toBeLessThanOrEqual(1_000);
  });

  it("una lista de destinatarios enorme queda acotada", () => {
    const out = cleanEvent(event({ to: Array.from({ length: 50_000 }, () => "a@example.com") }));
    expect(out.data.to.length).toBeLessThanOrEqual(100);
  });

  it("un evento normal queda igual", () => {
    const ev = event({});
    expect(cleanEvent(ev)).toEqual(ev);
  });
});
