import {
  JobCardSchema,
  buildJobCardPromptVars,
  finalizeJobCard,
  jobCardWire,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { createDemoLlm } from "./demo";
import { DEMO_JOB_CARD_FAIL_MARK, DEMO_JOB_CARD_INJECT_MARK, demoJobCard } from "./demo-job-card";

// Aviso inventado (Empresa A): las citas del modelo simulado salen de sus propias líneas.
const AVISO = `Empresa A busca una persona para Atención al Cliente en su local del centro.

Qué vas a hacer
- Atender a las personas que llegan al local.
- Registrar los pedidos en el sistema.

Requisitos indispensables:
- Al menos 2 años de experiencia en atención al público.
- Manejo de Excel.
Deseable:
- Inglés intermedio.

Condiciones
Modalidad presencial.
Jornada completa, de lunes a viernes.
Contratación en relación de dependencia.`;

async function run(texto: string) {
  const { vars, text } = buildJobCardPromptVars(texto);
  const r = await createDemoLlm().generateStructured("extract_job_card", JobCardSchema, vars);
  return { r, text };
}

describe("modelo simulado de la ficha (extract_job_card)", () => {
  it("la ficha cumple el esquema y el verificador la acepta entera", async () => {
    const { r, text } = await run(AVISO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.model).toBe("fake");
    const fin = finalizeJobCard(r.value.object, text);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.value.dropped).toEqual([]);
    const c = fin.value.card;
    expect(c.tareas.map((t) => t.texto)).toEqual([
      "Atender a las personas que llegan al local.",
      "Registrar los pedidos en el sistema.",
    ]);
    expect(c.requisitos.map((x) => x.nivel)).toEqual([
      "indispensable",
      "indispensable",
      "deseable",
    ]);
    expect(c.condiciones.modalidad?.valor).toBe("presencial");
    expect(c.condiciones.jornada?.valor).toBe("completa");
    expect(c.condiciones.contratacion?.valor).toBe("relacion_dependencia");
    expect(c.condiciones.experiencia?.anos).toBe(2);
    expect(c.habilidades.map((h) => h.nombre)).toEqual(["Excel"]);
    expect(c.condiciones.salario).toBeNull();
  });

  it("también cumple el esquema del proveedor", () => {
    expect(
      jobCardWire.schema.safeParse(demoJobCard({ job: `<<<AVISO>>>\n${AVISO}\n<<<FIN AVISO>>>` }))
        .success,
    ).toBe(true);
  });

  it("sin texto devuelve una ficha vacía y válida", async () => {
    const { r } = await run("   ");
    expect(r.ok).toBe(true);
  });

  it("la marca de falla devuelve algo que no cumple el esquema: la ficha queda fallida", async () => {
    const { r } = await run(`${AVISO}\n${DEMO_JOB_CARD_FAIL_MARK}`);
    expect(r.ok).toBe(false);
  });

  it("la marca de inyección simula a un modelo que obedeció: el verificador descarta el veredicto", async () => {
    const { r, text } = await run(`${AVISO}\n${DEMO_JOB_CARD_INJECT_MARK}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fin = finalizeJobCard(r.value.object, text);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.value.card.resumen).toBeNull();
    expect(fin.value.card.tareas.some((t) => /coincide|puntaje/i.test(t.texto))).toBe(false);
    expect(fin.value.dropped.length).toBeGreaterThanOrEqual(2);
  });

  it("registra la llamada en llm_calls con costo 0 y model fake", async () => {
    const rows: { task: string; model: string; costUsd?: number | null }[] = [];
    const llm = createDemoLlm({ calls: { record: async (c) => void rows.push(c) } });
    const { vars } = buildJobCardPromptVars(AVISO);
    await llm.generateStructured("extract_job_card", JobCardSchema, vars, {});
    expect(rows).toEqual([
      expect.objectContaining({ task: "extract_job_card", model: "fake", costUsd: 0 }),
    ]);
  });
});
