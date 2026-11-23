import { describe, expect, it } from "vitest";
import { cvForOffer, CV_FOR_OFFER_LIMITS } from "./cv-for-offer";
import type { CvHistoryInput } from "./cv-out/model";

const job = (bullets: string[], extra: Partial<CvHistoryInput> = {}): CvHistoryInput => ({
  kind: "trabajo",
  organization: "Empresa A",
  title: "Desarrolladora",
  startMonth: "2022-01",
  endMonth: null,
  bullets,
  ...extra,
});

describe("cvForOffer", () => {
  const offerSkills = [
    { name: "TypeScript", aliases: ["ts"], isMust: true },
    { name: "PostgreSQL", aliases: ["postgres"], isMust: true },
    { name: "Docker", isMust: false },
    { name: "Go", isMust: true },
  ];

  it("separa lo que el CV ya tiene de lo que falta, sin importar mayúsculas ni acentos", () => {
    const r = cvForOffer({
      offerSkills,
      cvSkills: ["typescript", "Postgres"],
      history: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.asked.filter((a) => a.inCv).map((a) => a.name)).toEqual([
      "TypeScript",
      "PostgreSQL",
    ]);
    expect(r.value.missing).toEqual([
      { name: "Docker", isMust: false },
      { name: "Go", isMust: true },
    ]);
  });

  it("ordena las viñetas por coincidencia y es estable en los empates", () => {
    const history = [
      job([
        "Armé reportes mensuales",
        "Migré datos a PostgreSQL",
        "Escribí servicios en TypeScript y PostgreSQL",
      ]),
      job(["Coordiné al equipo", "Usé Docker para el despliegue"], { organization: "Empresa B" }),
    ];
    const r = cvForOffer({ offerSkills, cvSkills: [], history });
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.bullets.map((b) => b.text)).toEqual([
      "Escribí servicios en TypeScript y PostgreSQL",
      "Migré datos a PostgreSQL",
      "Usé Docker para el despliegue",
      "Armé reportes mensuales",
      "Coordiné al equipo",
    ]);
    expect(r.value.bullets[0]!.matched).toEqual(["TypeScript", "PostgreSQL"]);
  });

  it("no reescribe ninguna viñeta: el texto sale idéntico al de entrada", () => {
    const original = "  Usé   TypeScript  con  espacios raros ";
    const r = cvForOffer({ offerSkills, cvSkills: [], history: [job([original])] });
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.bullets[0]!.text).toBe(original);
  });

  it("no cuenta una sigla dentro de otra palabra", () => {
    const r = cvForOffer({
      offerSkills,
      cvSkills: [],
      history: [job(["Fui al gobierno de Google", "Mantuve tsunami de datos"])],
    });
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.bullets.every((b) => b.matched.length === 0)).toBe(true);
  });

  it("sin skills pedidas devuelve error y no inventa nada", () => {
    const r = cvForOffer({ offerSkills: [], cvSkills: ["TypeScript"], history: [job(["x"])] });
    expect(r).toEqual({ ok: false, error: "sin_requisitos" });
  });

  it("sin viñetas ni skills en el CV devuelve error", () => {
    const r = cvForOffer({ offerSkills, cvSkills: [], history: [] });
    expect(r).toEqual({ ok: false, error: "sin_cv" });
  });

  it("respeta los topes y no se cuelga con 2 MB de texto", () => {
    const huge = "typescript ".repeat(Math.ceil((2 * 1024 * 1024) / 11));
    const t0 = performance.now();
    const r = cvForOffer({
      offerSkills,
      cvSkills: [huge],
      history: Array.from({ length: 50 }, () => job([huge, huge, huge])),
    });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(100);
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.bullets.length).toBeLessThanOrEqual(CV_FOR_OFFER_LIMITS.maxBullets);
  });
});
