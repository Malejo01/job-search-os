import { describe, expect, it } from "vitest";
import {
  BETA_OPENING_LABEL,
  buildWaitlistInvitationText,
  clampInviteCap,
  countWaitlistByRole,
  filterWaitlist,
  INVITE_CAP_DEFAULT,
  INVITE_CAP_MAX,
  normalizeOrigin,
  originOptions,
  parseWaitlistFilters,
  waitlistCsv,
  type WaitlistAdminEntry,
} from "./waitlist-admin";

function entry(over: Partial<WaitlistAdminEntry> & { id: string }): WaitlistAdminEntry {
  return {
    name: "Persona",
    email: `${over.id}@ejemplo.test`,
    role: "abogacia",
    heardFrom: null,
    createdAt: new Date("2026-10-20T15:00:00Z"),
    invitedAt: null,
    ...over,
  };
}

const LIST: WaitlistAdminEntry[] = [
  entry({
    id: "a",
    role: "abogacia",
    heardFrom: "Instagram",
    createdAt: new Date("2026-10-10T12:00:00Z"),
  }),
  entry({
    id: "b",
    role: "abogacia",
    heardFrom: "instagram ",
    createdAt: new Date("2026-10-20T12:00:00Z"),
  }),
  entry({
    id: "c",
    role: "comunicacion",
    heardFrom: "Una charla",
    createdAt: new Date("2026-10-25T12:00:00Z"),
  }),
  entry({
    id: "d",
    role: "comunicacion",
    heardFrom: null,
    createdAt: new Date("2026-10-28T12:00:00Z"),
    invitedAt: new Date("2026-10-29T12:00:00Z"),
  }),
  entry({
    id: "e",
    role: "frontend",
    heardFrom: "Instagrám",
    createdAt: new Date("2026-10-30T12:00:00Z"),
  }),
];
const ids = (list: WaitlistAdminEntry[]) => list.map((e) => e.id);

describe("normalizeOrigin", () => {
  it("junta mayúsculas, tildes y espacios; vacío o solo espacios es «sin dato»", () => {
    expect(normalizeOrigin("Instagram")).toBe("instagram");
    expect(normalizeOrigin("  INSTAGRÁM ")).toBe("instagram");
    expect(normalizeOrigin("una   charla")).toBe("una charla");
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("   ")).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });
});

describe("filterWaitlist", () => {
  it("sin filtros devuelve todo, sin cambiar el orden", () => {
    expect(ids(filterWaitlist(LIST, {}))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("filtra por carrera", () => {
    expect(ids(filterWaitlist(LIST, { role: "abogacia" }))).toEqual(["a", "b"]);
    expect(ids(filterWaitlist(LIST, { role: "ventas_b2b" }))).toEqual([]);
  });

  it("filtra por «cómo te enteraste» sin importar mayúsculas ni tildes", () => {
    expect(ids(filterWaitlist(LIST, { origin: "instagram" }))).toEqual(["a", "b", "e"]);
    expect(ids(filterWaitlist(LIST, { origin: "una charla" }))).toEqual(["c"]);
  });

  it("«sin dato» filtra a quienes no lo completaron", () => {
    expect(ids(filterWaitlist(LIST, { origin: "__sin_dato__" }))).toEqual(["d"]);
  });

  it("filtra por fecha de alta con los bordes incluidos, en días de Argentina", () => {
    expect(ids(filterWaitlist(LIST, { from: "2026-10-20", to: "2026-10-25" }))).toEqual(["b", "c"]);
    expect(ids(filterWaitlist(LIST, { from: "2026-10-26" }))).toEqual(["d", "e"]);
    expect(ids(filterWaitlist(LIST, { to: "2026-10-09" }))).toEqual([]);
    // 01:00 UTC del 21/10 es todavía el 20/10 en Argentina
    const late = entry({ id: "z", createdAt: new Date("2026-10-21T01:00:00Z") });
    expect(ids(filterWaitlist([late], { from: "2026-10-20", to: "2026-10-20" }))).toEqual(["z"]);
    expect(ids(filterWaitlist([late], { from: "2026-10-21" }))).toEqual([]);
  });

  it("filtra por estado de la invitación", () => {
    expect(ids(filterWaitlist(LIST, { status: "sin_invitar" }))).toEqual(["a", "b", "c", "e"]);
    expect(ids(filterWaitlist(LIST, { status: "invitadas" }))).toEqual(["d"]);
    expect(ids(filterWaitlist(LIST, { status: "todas" }))).toHaveLength(5);
  });

  it("combina los filtros", () => {
    expect(
      ids(filterWaitlist(LIST, { role: "abogacia", origin: "instagram", from: "2026-10-15" })),
    ).toEqual(["b"]);
  });

  it("no modifica la lista de entrada", () => {
    const copy = [...LIST];
    filterWaitlist(LIST, { role: "abogacia" });
    expect(LIST).toEqual(copy);
  });
});

describe("parseWaitlistFilters: lee la URL sin confiar en ella", () => {
  it("toma los valores válidos", () => {
    expect(
      parseWaitlistFilters({
        carrera: "abogacia",
        origen: "Instagram",
        desde: "2026-10-01",
        hasta: "2026-10-31",
        estado: "sin_invitar",
      }),
    ).toEqual({
      role: "abogacia",
      origin: "instagram",
      from: "2026-10-01",
      to: "2026-10-31",
      status: "sin_invitar",
    });
  });

  it("descarta fechas inválidas, estados desconocidos, carreras raras y arrays", () => {
    expect(
      parseWaitlistFilters({
        carrera: "no es una carrera!",
        desde: "31/10/2026",
        hasta: "2026-02-31",
        estado: "cualquiera",
        origen: ["a", "b"],
      }),
    ).toEqual({});
    expect(parseWaitlistFilters({})).toEqual({});
  });

  it("el origen largo se recorta", () => {
    const parsed = parseWaitlistFilters({ origen: "x".repeat(500) });
    expect(parsed.origin?.length).toBeLessThanOrEqual(200);
  });
});

describe("countWaitlistByRole: contador por carrera", () => {
  it("cuenta total y sin invitar por carrera, y ordena por cantidad sin invitar", () => {
    expect(countWaitlistByRole(LIST)).toEqual([
      { role: "abogacia", total: 2, pending: 2 },
      { role: "comunicacion", total: 2, pending: 1 },
      { role: "frontend", total: 1, pending: 1 },
    ]);
  });

  it("lista vacía no da filas", () => {
    expect(countWaitlistByRole([])).toEqual([]);
  });
});

describe("originOptions: opciones del filtro «cómo te enteraste»", () => {
  it("agrupa variantes, muestra la más usada y ordena por cantidad", () => {
    expect(originOptions(LIST)).toEqual([
      { key: "instagram", label: "Instagram", count: 3 },
      { key: "una charla", label: "Una charla", count: 1 },
    ]);
  });

  it("limita la cantidad de opciones", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      entry({ id: `x${i}`, heardFrom: `fuente ${i}` }),
    );
    expect(originOptions(many, 10)).toHaveLength(10);
  });
});

describe("clampInviteCap: tope de invitaciones por tanda", () => {
  it("usa 20 por defecto y respeta un valor válido hasta el máximo", () => {
    expect(INVITE_CAP_DEFAULT).toBe(20);
    expect(clampInviteCap(undefined)).toBe(20);
    expect(clampInviteCap("")).toBe(20);
    expect(clampInviteCap("abc")).toBe(20);
    expect(clampInviteCap("0")).toBe(20);
    expect(clampInviteCap("-4")).toBe(20);
    expect(clampInviteCap("2.5")).toBe(20);
    expect(clampInviteCap("5")).toBe(5);
    expect(clampInviteCap(8)).toBe(8);
    expect(clampInviteCap("100000")).toBe(INVITE_CAP_MAX);
  });

  it("el default configurable también se acota", () => {
    expect(clampInviteCap(undefined, "12")).toBe(12);
    expect(clampInviteCap(undefined, "9999")).toBe(INVITE_CAP_MAX);
    expect(clampInviteCap(undefined, "nada")).toBe(20);
  });
});

describe("waitlistCsv: exportación", () => {
  const label = (role: string) =>
    ({ abogacia: "Abogacía", comunicacion: "Comunicación" })[role] ?? role;

  it("lleva solo nombre, email, carrera, origen y fecha", () => {
    const csv = waitlistCsv([LIST[0]!], label);
    const [header, row] = csv.replace("﻿", "").trim().split("\r\n");
    expect(header).toBe("nombre,email,carrera,origen,fecha");
    expect(row).toBe("Persona,a@ejemplo.test,Abogacía,Instagram,2026-10-10");
  });

  it("no filtra columnas internas (id, invitación, IP)", () => {
    const csv = waitlistCsv(LIST, label);
    expect(csv).not.toMatch(/invit|ip_hash|uuid/i);
    expect(csv.replace("﻿", "").trim().split("\r\n")[0]!.split(",")).toHaveLength(5);
  });

  it("entrecomilla comas, comillas y saltos de línea", () => {
    const csv = waitlistCsv(
      [entry({ id: "q", name: 'Ana "la" Pérez, Jr.', heardFrom: "una\nlínea" })],
      label,
    );
    expect(csv).toContain('"Ana ""la"" Pérez, Jr."');
    expect(csv).toContain('"una\nlínea"');
  });

  it("neutraliza fórmulas de planilla (=, +, -, @) en cualquier celda", () => {
    const csv = waitlistCsv(
      [
        entry({ id: "f1", name: '=HYPERLINK("http://x")', heardFrom: "+54 11" }),
        entry({ id: "f2", name: "@cmd", heardFrom: "-1+1" }),
      ],
      label,
    );
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+54 11");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain("'-1+1");
  });

  it("sin origen deja la celda vacía y empieza con BOM para que Excel lea las tildes", () => {
    const csv = waitlistCsv([LIST[3]!], label);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.trim().split("\r\n")[1]).toBe("Persona,d@ejemplo.test,Comunicación,,2026-10-28");
  });

  it("lista vacía da solo el encabezado", () => {
    expect(waitlistCsv([], label).replace("﻿", "")).toBe("nombre,email,carrera,origen,fecha\r\n");
  });
});

describe("buildWaitlistInvitationText", () => {
  const base = {
    name: "Ana Pérez",
    link: "https://app.example/register?code=abc",
    expiresAt: new Date("2026-11-14T15:00:00Z"),
  };

  it("dice que la beta abre el jueves 26/11 y lleva el link y el vencimiento", () => {
    expect(BETA_OPENING_LABEL).toBe("jueves 26/11");
    const text = buildWaitlistInvitationText(base);
    expect(text).toContain("jueves 26/11");
    expect(text).toContain("https://app.example/register?code=abc");
    expect(text).toContain("14 de noviembre");
    expect(text.startsWith("Hola Ana:")).toBe(true);
  });

  it("no promete resultados ni garantías", () => {
    expect(buildWaitlistInvitationText(base)).not.toMatch(
      /garant|empleo|trabajo seguro|te van a llamar/i,
    );
  });

  it("sin nombre saluda sin nombre", () => {
    expect(buildWaitlistInvitationText({ ...base, name: "  " }).startsWith("Hola,")).toBe(true);
  });
});
