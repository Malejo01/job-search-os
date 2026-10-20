import { describe, expect, it } from "vitest";
import { roleGapMessage, summarizeRoleGap, type RoleGapInput } from "./role-gaps";

const senior = { reason: "titulo_blocklist", detail: "'senior' en el título" };
const lead = { reason: "titulo_blocklist", detail: "'lead' en el título" };
const remote = { reason: "modalidad_no_remota", detail: "modalidad hibrido" };
const trade = { reason: "disciplina_distinta", detail: "keyword 'seo' en el título" };
const badge = { reason: "badge_aptitudes", detail: "aptitudes 10% < 30%" };

const input = (over: Partial<RoleGapInput> = {}): RoleGapInput => ({
  role: "data_analyst",
  label: "Data Analyst",
  poolCount: 0,
  discards: [],
  pendingCount: 0,
  ...over,
});
const many = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

describe("summarizeRoleGap", () => {
  it("sin avisos", () => {
    const sum = summarizeRoleGap(input());
    expect(sum.mainCause).toBe("sin_avisos");
    expect(sum.total).toBe(0);
    expect(sum.groups).toEqual([]);
    expect(roleGapMessage(sum)).toBe(
      "Todavía no hay ofertas de Data Analyst en las fuentes que miramos (últimas 2 semanas).",
    );
  });

  it("agrupa la blocklist por palabra y ordena por cantidad", () => {
    const sum = summarizeRoleGap(
      input({
        poolCount: 7,
        discards: [...many(1, lead), ...many(4, senior), ...many(2, remote)],
      }),
    );
    expect(sum.groups).toEqual([
      { key: "blocklist:senior", text: "piden Senior", count: 4 },
      { key: "modalidad", text: "no son de una modalidad que aceptás", count: 2 },
      { key: "blocklist:lead", text: "piden Lead", count: 1 },
    ]);
    expect(sum.mainCause).toBe("blocklist");
  });

  it("clasifica modalidad, disciplina y otros", () => {
    expect(summarizeRoleGap(input({ poolCount: 3, discards: many(3, remote) })).mainCause).toBe(
      "modalidad",
    );
    expect(
      summarizeRoleGap(input({ poolCount: 3, discards: many(3, trade) })).groups[0]?.text,
    ).toBe("son de otro oficio");
    const other = summarizeRoleGap(input({ poolCount: 2, discards: many(2, badge) }));
    expect(other.mainCause).toBe("otros");
    expect(other.groups[0]).toEqual({ key: "otros", text: "no pasan tus filtros", count: 2 });
  });

  it("ubicación y nivel tienen su propio motivo", () => {
    const place = { reason: "ubicacion", detail: "solo US" };
    const level = { reason: "nivel", detail: "staff_plus con 3 años" };
    const a = summarizeRoleGap(input({ poolCount: 3, discards: many(3, place) }));
    expect(a.mainCause).toBe("ubicacion");
    expect(roleGapMessage(a)).toBe("Hay 3 ofertas de Data Analyst: todas no habilitan tu país.");
    const b = summarizeRoleGap(input({ poolCount: 1, discards: [level] }));
    expect(b.mainCause).toBe("nivel");
    expect(roleGapMessage(b)).toBe("Hay 1 oferta de Data Analyst: pide más experiencia.");
  });

  it("blocklist sin palabra entre comillas cae en otros", () => {
    const sum = summarizeRoleGap(
      input({
        poolCount: 1,
        discards: [{ reason: "titulo_blocklist", detail: "sin comillas" }],
      }),
    );
    expect(sum.groups).toEqual([{ key: "otros", text: "no pasan tus filtros", count: 1 }]);
    expect(sum.mainCause).toBe("otros");
  });

  it("solo pendientes", () => {
    const sum = summarizeRoleGap(input({ poolCount: 3, pendingCount: 3 }));
    expect(sum.mainCause).toBe("pendientes");
    expect(sum.pending).toBe(3);
  });
});

describe("roleGapMessage", () => {
  it("8 avisos, todas piden Senior", () => {
    const msg = roleGapMessage(
      summarizeRoleGap(input({ poolCount: 8, discards: many(8, senior) })),
    );
    expect(msg).toBe(
      "Hay 8 ofertas de Data Analyst: todas piden Senior (lo excluís en tus criterios).",
    );
  });

  it("singular concuerda", () => {
    const msg = roleGapMessage(summarizeRoleGap(input({ poolCount: 1, discards: [senior] })));
    expect(msg).toBe("Hay 1 oferta de Data Analyst: pide Senior (lo excluís en tus criterios).");
    expect(roleGapMessage(summarizeRoleGap(input({ poolCount: 1, discards: [remote] })))).toBe(
      "Hay 1 oferta de Data Analyst: no es de una modalidad que aceptás.",
    );
  });

  it("mezcla 8/4", () => {
    const msg = roleGapMessage(
      summarizeRoleGap(
        input({ poolCount: 12, discards: [...many(8, senior), ...many(4, remote)] }),
      ),
    );
    expect(msg).toBe(
      "Hay 12 ofertas de Data Analyst: 8 piden Senior (lo excluís en tus criterios), 4 no son de una modalidad que aceptás.",
    );
  });

  it("mezcla con cinco motivos: tres y el resto en otros motivos", () => {
    const msg = roleGapMessage(
      summarizeRoleGap(
        input({
          poolCount: 15,
          discards: [
            ...many(5, senior),
            ...many(4, remote),
            ...many(3, trade),
            ...many(2, lead),
            ...many(1, badge),
          ],
        }),
      ),
    );
    expect(msg).toBe(
      "Hay 15 ofertas de Data Analyst: 5 piden Senior (lo excluís en tus criterios), 4 no son de una modalidad que aceptás, 3 son de otro oficio y 3 por otros motivos.",
    );
  });

  it("con pendientes", () => {
    const msg = roleGapMessage(
      summarizeRoleGap(input({ poolCount: 6, discards: many(4, senior), pendingCount: 2 })),
    );
    expect(msg).toBe(
      "Hay 6 ofertas de Data Analyst: 4 piden Senior (lo excluís en tus criterios). 2 pasan tus filtros y se van sumando con tu tope diario.",
    );
    expect(roleGapMessage(summarizeRoleGap(input({ poolCount: 3, pendingCount: 3 })))).toBe(
      "Hay 3 ofertas de Data Analyst: todas pasan tus filtros y se van sumando con tu tope diario.",
    );
    expect(roleGapMessage(summarizeRoleGap(input({ poolCount: 1, pendingCount: 1 })))).toBe(
      "Hay 1 oferta de Data Analyst: pasa tus filtros y se va sumando con tu tope diario.",
    );
  });

  it("palabras de blocklist con espacio", () => {
    const sum = summarizeRoleGap(
      input({
        poolCount: 2,
        discards: many(2, { reason: "titulo_blocklist", detail: "'head of' en el título" }),
      }),
    );
    expect(sum.groups[0]).toEqual({ key: "blocklist:head of", text: "piden Head of", count: 2 });
    expect(roleGapMessage(sum)).toBe(
      "Hay 2 ofertas de Data Analyst: todas piden Head of (lo excluís en tus criterios).",
    );
  });
});
