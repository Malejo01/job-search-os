import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const src = (f: string) => readFileSync(join(WEB, f), "utf8");

describe("estados vacíos con la marca (R23-07)", () => {
  const PANTALLAS = [
    "app/(app)/hoy/page.tsx",
    "app/(app)/jobs/page.tsx",
    "app/(app)/jobs/pending-jd/page.tsx",
    "app/(app)/applications/page.tsx",
    "app/(app)/cv/page.tsx",
    "app/(app)/academy/page.tsx",
    "app/(app)/jobs/[id]/postular/page.tsx",
  ];

  // R28-15: Hoy ya tiene a Afi hablando arriba (<AfiDice>) y lleva un solo Afi por pantalla, así que sus vacíos
  // de novedades van con EmptyState sin figura. Los demás vacíos de Hoy siguen con EstadoMarca.
  const CON_AFI_DICE = new Set(["app/(app)/hoy/page.tsx"]);

  it("cada pantalla usa EstadoMarca y ya no arma EmptyState a mano", () => {
    for (const f of PANTALLAS) {
      const s = src(f);
      expect(s, f).toContain("<EstadoMarca");
      if (CON_AFI_DICE.has(f)) expect(s, f).toContain("<AfiDice");
      else expect(s, f).not.toMatch(/<EmptyState/);
    }
  });

  it("el componente es un Server Component (sin 'use client' ni hooks)", () => {
    const s = src("components/estado-marca.tsx");
    expect(s).not.toMatch(/["']use client["']/);
    expect(s).not.toMatch(/\buse(State|Effect|Ref)\b/);
  });

  it("el error de la app no muestra error.message y ofrece reintentar y volver a Hoy", () => {
    const s = src("app/(app)/error.tsx");
    expect(s).not.toMatch(/error\.message/);
    expect(s).toContain("reset()");
    expect(s).toContain('href="/hoy"');
  });

  it("el buscador de Academy recibe el vacío armado en el servidor (no importa la marca)", () => {
    const s = src("app/(app)/academy/academy-buscador.tsx");
    expect(s).not.toContain("estado-marca");
    expect(s).toContain("sinResultados");
  });
});
