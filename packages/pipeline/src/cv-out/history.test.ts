import { describe, expect, it } from "vitest";
import { parseBullets, validateHistory } from "./history";

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const base = { kind: "trabajo", organization: "Empresa A", title: "Cargo Ficticio" };

describe("validateHistory", () => {
  it("acepta una entrada mínima y una completa", () => {
    expect(validateHistory(form(base))).toMatchObject({ ok: true });
    expect(
      validateHistory(
        form({
          ...base,
          startMonth: "2022-03",
          endMonth: "2024-01",
          bullets: "Uno\n\n Dos \r\nTres",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        ...base,
        startMonth: "2022-03",
        endMonth: "2024-01",
        bullets: ["Uno", "Dos", "Tres"],
        link: null,
      },
    });
  });

  it("devuelve el campo que falló, sin el valor", () => {
    expect(validateHistory(form({ ...base, kind: "hobby" }))).toEqual({ ok: false, field: "kind" });
    expect(validateHistory(form({ ...base, organization: " " }))).toEqual({
      ok: false,
      field: "organization",
    });
    expect(validateHistory(form({ ...base, title: "x".repeat(121) }))).toEqual({
      ok: false,
      field: "title",
    });
    expect(validateHistory(form({ ...base, startMonth: "2022-13" }))).toEqual({
      ok: false,
      field: "startMonth",
    });
    expect(validateHistory(form({ ...base, endMonth: "2024-01" }))).toEqual({
      ok: false,
      field: "dates",
    });
    expect(validateHistory(form({ ...base, startMonth: "2024-05", endMonth: "2024-01" }))).toEqual({
      ok: false,
      field: "dates",
    });
  });

  it("empresa y cargo rechazan links, dominios sueltos y emails (SEC-C25-1/2)", () => {
    for (const bad of [
      "https://ejemplo.test/x",
      "miweb.dev",
      "yo@ejemplo.test",
      "www.ejemplo.test",
    ]) {
      expect(validateHistory(form({ ...base, organization: bad }))).toEqual({
        ok: false,
        field: "organization",
      });
      expect(validateHistory(form({ ...base, title: bad }))).toEqual({
        ok: false,
        field: "title",
      });
    }
    expect(validateHistory(form({ ...base, organization: "Node.js SA" })).ok).toBe(true);
  });

  it("viñetas: 6, 220 caracteres, sin links, dominios ni emails", () => {
    const seis = Array.from({ length: 6 }, (_, i) => `v${i}`).join("\n");
    expect(validateHistory(form({ ...base, bullets: seis })).ok).toBe(true);
    for (const bullets of [
      `${seis}\nv7`,
      "x".repeat(221),
      "Mirá https://ejemplo.test/x",
      "Mirá miweb.dev",
      "Escribime a yo@ejemplo.test",
    ]) {
      expect(validateHistory(form({ ...base, bullets })), bullets).toEqual({
        ok: false,
        field: "bullets",
      });
    }
    expect(validateHistory(form({ ...base, bullets: "x".repeat(220) })).ok).toBe(true);
  });

  it("proyecto (R12-4): nombre, rol, stack como viñeta y link https", () => {
    const proyecto = {
      kind: "proyecto",
      organization: "Proyecto 1",
      title: "Desarrolladora frontend",
      bullets: "Armé el tablero de turnos\nStack: React, Node.js, PostgreSQL",
      link: " https://github.com/persona-ficticia/proyecto-1 ",
    };
    expect(validateHistory(form(proyecto))).toEqual({
      ok: true,
      value: {
        kind: "proyecto",
        organization: "Proyecto 1",
        title: "Desarrolladora frontend",
        startMonth: null,
        endMonth: null,
        bullets: ["Armé el tablero de turnos", "Stack: React, Node.js, PostgreSQL"],
        link: "https://github.com/persona-ficticia/proyecto-1",
      },
    });
    // sin link también vale
    expect(validateHistory(form({ ...proyecto, link: "" }))).toMatchObject({
      ok: true,
      value: { link: null },
    });
  });

  it("link inválido: http, email, más de 200 caracteres, espacios o credenciales", () => {
    const proyecto = { kind: "proyecto", organization: "Proyecto 1", title: "Rol ficticio" };
    for (const link of [
      "http://ejemplo.test/proyecto",
      "persona@ejemplo.test",
      "mailto:persona@ejemplo.test",
      "https://persona@ejemplo.test/x",
      `https://ejemplo.test/${"x".repeat(180)}`,
      "https://ejemplo.test/a b",
      "https://ejemplo.test/contacto?mail=persona@ejemplo.test",
      "https://localhost",
      "javascript:alert(1)",
    ]) {
      expect(validateHistory(form({ ...proyecto, link })), link).toEqual({
        ok: false,
        field: "link",
      });
    }
    // 200 justos pasan
    const exacto = `https://ejemplo.test/${"x".repeat(179)}`;
    expect(exacto).toHaveLength(200);
    expect(validateHistory(form({ ...proyecto, link: exacto })).ok).toBe(true);
    expect(
      validateHistory(form({ ...proyecto, link: "https://medium.com/@persona-ficticia/post" })).ok,
    ).toBe(true);
  });

  it("el link va solo en proyectos; en los demás campos sigue rechazado", () => {
    expect(validateHistory(form({ ...base, link: "https://ejemplo.test/proyecto" }))).toEqual({
      ok: false,
      field: "link",
    });
    const proyecto = {
      kind: "proyecto",
      organization: "Proyecto 1",
      title: "Rol ficticio",
      link: "https://ejemplo.test/proyecto",
    };
    expect(validateHistory(form({ ...proyecto, organization: "miweb.dev" }))).toEqual({
      ok: false,
      field: "organization",
    });
    expect(validateHistory(form({ ...proyecto, title: "https://ejemplo.test" }))).toEqual({
      ok: false,
      field: "title",
    });
    expect(
      validateHistory(form({ ...proyecto, bullets: "Demo en https://ejemplo.test/demo" })),
    ).toEqual({ ok: false, field: "bullets" });
  });

  it("parseBullets ignora vacías", () => {
    expect(parseBullets("\n  \n")).toEqual([]);
    expect(parseBullets(null)).toEqual([]);
  });
});
