import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_STEPS,
  assistantStep,
  GMAIL_FILTERS_URL,
  GMAIL_FORWARDING_PATH,
  type AssistantFacts,
} from "./assistant-step";

const none: AssistantFacts = {
  legacyAddress: false,
  gmailConfirmationPending: false,
  gmailConfirmationSeen: false,
  filtersAcknowledged: false,
  firstAlertReceived: false,
};
const facts = (over: Partial<AssistantFacts>): AssistantFacts => ({ ...none, ...over });

describe("assistantStep", () => {
  it("sin nada hecho: agregar la dirección", () => {
    expect(assistantStep(none)).toBe("agregar_direccion");
  });
  it("dirección vieja", () => {
    expect(assistantStep(facts({ legacyAddress: true }))).toBe("direccion_vieja");
  });
  it("llegó la confirmación de Gmail: confirmar el reenvío", () => {
    expect(assistantStep(facts({ gmailConfirmationPending: true }))).toBe("confirmar_reenvio");
  });
  it("confirmación vista y filtros sin importar: importar filtros", () => {
    expect(assistantStep(facts({ gmailConfirmationSeen: true }))).toBe("importar_filtros");
  });
  it("filtros importados: esperar la alerta", () => {
    expect(assistantStep(facts({ gmailConfirmationSeen: true, filtersAcknowledged: true }))).toBe(
      "esperando_alerta",
    );
  });
  it("primera alerta recibida: listo", () => {
    expect(assistantStep(facts({ firstAlertReceived: true }))).toBe("listo");
  });

  it("la dirección vieja gana sobre todo lo demás", () => {
    expect(
      assistantStep({
        legacyAddress: true,
        gmailConfirmationPending: true,
        gmailConfirmationSeen: true,
        filtersAcknowledged: true,
        firstAlertReceived: true,
      }),
    ).toBe("direccion_vieja");
  });
  it("listo gana sobre un pedido de confirmación pendiente", () => {
    expect(assistantStep(facts({ firstAlertReceived: true, gmailConfirmationPending: true }))).toBe(
      "listo",
    );
  });
  it("confirmar el reenvío gana sobre importar filtros y esperar", () => {
    expect(
      assistantStep(
        facts({
          gmailConfirmationPending: true,
          gmailConfirmationSeen: true,
          filtersAcknowledged: true,
        }),
      ),
    ).toBe("confirmar_reenvio");
  });
  it("importar filtros gana sobre esperar mientras falte el reconocimiento", () => {
    expect(assistantStep(facts({ gmailConfirmationSeen: true, filtersAcknowledged: false }))).toBe(
      "importar_filtros",
    );
  });
  it("filtros reconocidos sin confirmación registrada (se perdió): sigue esperando", () => {
    expect(assistantStep(facts({ filtersAcknowledged: true }))).toBe("esperando_alerta");
  });

  it("cubre los seis estados en las 32 combinaciones y respeta la prioridad", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 32; n++) {
      const f: AssistantFacts = {
        legacyAddress: Boolean(n & 1),
        gmailConfirmationPending: Boolean(n & 2),
        gmailConfirmationSeen: Boolean(n & 4),
        filtersAcknowledged: Boolean(n & 8),
        firstAlertReceived: Boolean(n & 16),
      };
      const step = assistantStep(f);
      seen.add(step);
      if (f.legacyAddress) expect(step).toBe("direccion_vieja");
      else if (f.firstAlertReceived) expect(step).toBe("listo");
      else if (f.gmailConfirmationPending) expect(step).toBe("confirmar_reenvio");
    }
    expect([...seen].sort()).toEqual(
      [
        "agregar_direccion",
        "confirmar_reenvio",
        "direccion_vieja",
        "esperando_alerta",
        "importar_filtros",
        "listo",
      ].sort(),
    );
  });
});

describe("links de Gmail", () => {
  const assistantSource = readFileSync(
    resolve(__dirname, "../../../apps/web/app/onboarding/asistente/assistant.tsx"),
    "utf8",
  );

  it("el único link directo es a Filtros", () => {
    expect(GMAIL_FILTERS_URL).toBe("https://mail.google.com/mail/u/0/#settings/filters");
  });
  it("el recorrido al reenvío es texto y no lleva link", () => {
    expect(GMAIL_FORWARDING_PATH).toContain("Reenvío y correo POP/IMAP");
    expect(GMAIL_FORWARDING_PATH).not.toMatch(/https?:/);
  });
  it("la pantalla no conserva el link viejo de reenvío", () => {
    expect(assistantSource).not.toContain("fwdandpop");
    expect(assistantSource).not.toContain("GMAIL_FORWARDING_URL");
    expect(assistantSource).toContain("GMAIL_FILTERS_URL");
  });
});

describe("ASSISTANT_STEPS", () => {
  it("son los cinco pasos visibles, en orden", () => {
    expect(ASSISTANT_STEPS).toEqual([
      "agregar_direccion",
      "confirmar_reenvio",
      "importar_filtros",
      "esperando_alerta",
      "listo",
    ]);
  });
});
