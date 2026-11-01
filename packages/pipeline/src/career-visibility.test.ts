import { describe, expect, it } from "vitest";
import { CAREER_REVEAL_THRESHOLD, type CareerRevealCount } from "./career-reveal";
import {
  CAREER_VISIBILITY_OVERRIDES,
  PUBLIC_THRESHOLD_ROLE_KEYS,
  isCareerPublic,
  publicCareerKeys,
  watchedCareerKeys,
} from "./career-visibility";
import { BETA_ROLE_KEYS, ROLE_KEYS, type RoleKey } from "./skills/self-assessment";

const none = { alwaysHidden: [], alwaysVisible: [] } as const;
const count = (role: RoleKey, received: number): CareerRevealCount => ({
  role,
  received,
  active: received,
});

describe("qué carreras se muestran en público (ADR-029)", () => {
  it("las que están sujetas al umbral son las de la beta", () => {
    expect([...PUBLIC_THRESHOLD_ROLE_KEYS]).toEqual([...BETA_ROLE_KEYS]);
  });

  it("una carrera sujeta al umbral se muestra con 10 ofertas o más y no con 9", () => {
    const nine = publicCareerKeys([count("abogacia", CAREER_REVEAL_THRESHOLD - 1)], none);
    expect(nine).not.toContain("abogacia");
    const ten = publicCareerKeys([count("abogacia", CAREER_REVEAL_THRESHOLD)], none);
    expect(ten).toContain("abogacia");
    expect(publicCareerKeys([count("abogacia", 40)], none)).toContain("abogacia");
  });

  it("cada carrera se mide sola: las demás de la beta siguen ocultas", () => {
    const keys = publicCareerKeys([count("abogacia", 17)], none);
    expect(keys).toContain("abogacia");
    for (const k of BETA_ROLE_KEYS.filter((x) => x !== "abogacia")) expect(keys).not.toContain(k);
  });

  it("las carreras fuera del umbral se muestran siempre", () => {
    const keys = publicCareerKeys([], none);
    for (const k of ROLE_KEYS.filter((x) => !PUBLIC_THRESHOLD_ROLE_KEYS.includes(x))) {
      expect(keys).toContain(k);
    }
  });

  it("sin datos (null) falla cerrado: las sujetas al umbral se ocultan, el resto sigue", () => {
    const keys = publicCareerKeys(null, none);
    for (const k of PUBLIC_THRESHOLD_ROLE_KEYS) expect(keys).not.toContain(k);
    expect(keys).toContain("data_analyst");
    expect(keys.length).toBe(ROLE_KEYS.length - PUBLIC_THRESHOLD_ROLE_KEYS.length);
  });

  it("con una lista vacía de conteos (el pool no tiene ofertas) también quedan ocultas", () => {
    const keys = publicCareerKeys([], none);
    for (const k of PUBLIC_THRESHOLD_ROLE_KEYS) expect(keys).not.toContain(k);
  });

  it("override «siempre oculta» gana aunque llegue al umbral", () => {
    const keys = publicCareerKeys([count("comunicacion", 99)], {
      alwaysHidden: ["comunicacion", "data_analyst"],
      alwaysVisible: [],
    });
    expect(keys).not.toContain("comunicacion");
    // Vale también para una carrera que no estaba sujeta al umbral
    expect(keys).not.toContain("data_analyst");
  });

  it("override «siempre visible» gana con 0 ofertas y sin datos", () => {
    const o = { alwaysHidden: [], alwaysVisible: ["relaciones_internacionales" as RoleKey] };
    expect(publicCareerKeys([], o)).toContain("relaciones_internacionales");
    expect(publicCareerKeys(null, o)).toContain("relaciones_internacionales");
  });

  it("si una carrera está en las dos listas, oculta gana (la opción conservadora)", () => {
    const o = { alwaysHidden: ["abogacia" as RoleKey], alwaysVisible: ["abogacia" as RoleKey] };
    expect(publicCareerKeys([count("abogacia", 50)], o)).not.toContain("abogacia");
  });

  it("conserva el orden de ROLE_KEYS y no repite", () => {
    const keys = publicCareerKeys(
      BETA_ROLE_KEYS.map((k) => count(k, 20)),
      none,
    );
    expect(keys).toEqual(ROLE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignora conteos de carreras que no existen o con números raros", () => {
    const keys = publicCareerKeys(
      [
        { role: "inexistente", received: 500, active: 500 },
        { role: "abogacia", received: Number.NaN, active: 0 },
        { role: "comunicacion", received: -3, active: 0 },
      ],
      none,
    );
    expect(keys).not.toContain("abogacia");
    expect(keys).not.toContain("comunicacion");
    expect(keys.length).toBe(ROLE_KEYS.length - PUBLIC_THRESHOLD_ROLE_KEYS.length);
  });

  it("usa el mismo conteo y el mismo umbral que la tabla «lista para mostrarse»", () => {
    expect(CAREER_REVEAL_THRESHOLD).toBe(10);
    // `received` es lo que compara el panel: `active` solo no alcanza
    const keys = publicCareerKeys([{ role: "abogacia", received: 3, active: 30 }], none);
    expect(keys).not.toContain("abogacia");
  });

  it("isCareerPublic dice lo mismo que publicCareerKeys", () => {
    const counts = [count("abogacia", 12)];
    expect(isCareerPublic("abogacia", counts, none)).toBe(true);
    expect(isCareerPublic("comunicacion", counts, none)).toBe(false);
    expect(isCareerPublic("abogacia", null, none)).toBe(false);
  });

  it("los overrides por defecto dejan oculta asistencia_operaciones, como hoy", () => {
    expect(CAREER_VISIBILITY_OVERRIDES.alwaysHidden).toContain("asistencia_operaciones");
    expect(publicCareerKeys([count("asistencia_operaciones", 99)])).not.toContain(
      "asistencia_operaciones",
    );
  });

  it("las carreras vigiladas (para el panel) son las del umbral más las siempre ocultas", () => {
    const watched = watchedCareerKeys(none);
    expect(watched).toEqual([...PUBLIC_THRESHOLD_ROLE_KEYS]);
    expect(
      watchedCareerKeys({ alwaysHidden: ["asistencia_operaciones"], alwaysVisible: [] }),
    ).toEqual([...PUBLIC_THRESHOLD_ROLE_KEYS, "asistencia_operaciones"]);
  });
});
