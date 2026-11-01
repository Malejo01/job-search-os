import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@job-search-os/db";
import {
  clearSkillsCatalogCache,
  loadChecklistSkills,
  SKILLS_CATALOG_TTL_MS,
} from "./evaluate-job";

/**
 * Caché del catálogo de skills del worker (C5-7): una base falsa que cuenta cuántas veces se lee el
 * catálogo, para probar que un lote de evaluaciones no lo baja una vez por oferta.
 */
const CATALOG = [
  { slug: "excel", name: "Excel", aliases: ["microsoft excel"] },
  { slug: "sql", name: "SQL", aliases: [] },
];

function fakeDb() {
  const calls = { catalog: 0, levels: 0, own: 0 };
  const chain = (rows: unknown[]) => {
    const p: Record<string, unknown> = {};
    p.from = () => p;
    p.innerJoin = () => p;
    p.where = () => p;
    p.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return p;
  };
  const db = {
    select: (shape: Record<string, unknown>) => {
      if ("aliases" in shape) {
        calls.catalog++;
        return chain(CATALOG);
      }
      if ("level" in shape && "slug" in shape) {
        calls.levels++;
        return chain([{ slug: "excel", level: 2 }]);
      }
      calls.own++;
      return chain([{ name: "Contabilidad de costos", level: 3 }]);
    },
  };
  return { db: db as unknown as Db, calls };
}

describe("loadChecklistSkills · caché del catálogo (C5-7)", () => {
  beforeEach(() => clearSkillsCatalogCache());

  it("un lote de 50 evaluaciones lee el catálogo una sola vez", async () => {
    const { db, calls } = fakeDb();
    for (let i = 0; i < 50; i++) await loadChecklistSkills(db, `user-${i}`, 1_000);
    expect(calls.catalog).toBe(1);
    // Lo de cada persona sí se lee en cada llamada
    expect(calls.levels).toBe(50);
    expect(calls.own).toBe(50);
  });

  it("devuelve los niveles de la persona y el catálogo compilado", async () => {
    const { db } = fakeDb();
    const res = await loadChecklistSkills(db, "user-1", 1_000);
    expect(res.skillLevels.get("excel")).toBe(2);
    expect(res.userSkills).toEqual([{ name: "Contabilidad de costos", level: 3 }]);
    expect(res.skillNames?.get("sql")).toBe("SQL");
    expect(res.terms.length).toBeGreaterThan(0);
  });

  it("vuelve a leer el catálogo cuando pasó el tiempo de vida", async () => {
    const { db, calls } = fakeDb();
    await loadChecklistSkills(db, "user-1", 0);
    await loadChecklistSkills(db, "user-1", SKILLS_CATALOG_TTL_MS - 1);
    expect(calls.catalog).toBe(1);
    await loadChecklistSkills(db, "user-1", SKILLS_CATALOG_TTL_MS + 1);
    expect(calls.catalog).toBe(2);
  });

  it("clearSkillsCatalogCache fuerza una lectura nueva", async () => {
    const { db, calls } = fakeDb();
    await loadChecklistSkills(db, "user-1", 0);
    clearSkillsCatalogCache();
    await loadChecklistSkills(db, "user-1", 1);
    expect(calls.catalog).toBe(2);
  });
});
