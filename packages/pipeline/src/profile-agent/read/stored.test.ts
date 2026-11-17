import { describe, expect, it } from "vitest";
import {
  parseStoredRead,
  pruneStoredRead,
  storedSuggestedRoles,
  type StoredProfileRead,
} from "./stored";

const stored = (): StoredProfileRead => ({
  ticket: "pa1.abc.123.mac",
  summary: {
    experience: 1,
    education: 0,
    skills: 1,
    languages: 0,
    dropped: 0,
    suggestedRoles: ["fullstack"],
  },
  proposal: {
    cards: [
      {
        kind: "experience",
        id: "exp:0",
        organization: "Empresa A",
        title: "Desarrolladora",
        startMonth: "2021-03",
        endMonth: null,
        isCurrent: true,
        bullets: [],
      },
      { kind: "skill", id: "skill:0", name: "TypeScript", slug: null, level: 2, verified: true },
    ],
    suggestedRoles: ["fullstack"],
    dropped: 0,
  },
});

describe("lectura guardada en la pestaña (R11-1: recargar no gasta otra lectura)", () => {
  it("vuelve a leer lo que se guardó, solo si el ticket es el de la charla", () => {
    const raw = JSON.stringify(stored());
    expect(parseStoredRead(raw, "pa1.abc.123.mac")).toEqual(stored());
    expect(parseStoredRead(raw, "pa1.otro.123.mac")).toBeNull();
    expect(parseStoredRead(raw, null)).toBeNull();
  });

  it("una etapa que reemite el ticket (mismo id de charla, otra firma) no rompe la lectura guardada", () => {
    const first = `pa1.0123456789ab.1900000000000.${"A".repeat(43)}`;
    const reissued = `pa1.0123456789ab.1900000999999.${"B".repeat(43)}`;
    const other = `pa1.ba9876543210.1900000999999.${"B".repeat(43)}`;
    const raw = JSON.stringify({ ...stored(), ticket: first });
    expect(parseStoredRead(raw, reissued)?.ticket).toBe(first);
    expect(parseStoredRead(raw, other)).toBeNull();
  });

  it("lo roto, vacío o con claves de más no se usa", () => {
    expect(parseStoredRead(null, "t")).toBeNull();
    expect(parseStoredRead("no es json", "t")).toBeNull();
    expect(parseStoredRead("{}", "t")).toBeNull();
    const extra = JSON.stringify({ ...stored(), cvText: "texto del CV" });
    expect(parseStoredRead(extra, "pa1.abc.123.mac")).toBeNull();
    const badCard = stored();
    (badCard.proposal.cards[0] as { organization: string }).organization = "https://sitio.example";
    expect(parseStoredRead(JSON.stringify(badCard), "pa1.abc.123.mac")).toBeNull();
  });

  it("sacar las tarjetas resueltas deja las pendientes y los puestos sugeridos", () => {
    const left = pruneStoredRead(stored(), ["exp:0"]);
    expect(left.proposal.cards.map((c) => c.id)).toEqual(["skill:0"]);
    expect(left.proposal.suggestedRoles).toEqual(["fullstack"]);
    expect(left.ticket).toBe("pa1.abc.123.mac");
    expect(left.settled).toBe(true);
    // sin tarjetas resueltas no cambia nada
    expect(pruneStoredRead(stored(), []).settled).toBe(false);
  });

  it("los puestos sugeridos salen de lo guardado y se filtran contra las carreras conocidas", () => {
    expect(storedSuggestedRoles(JSON.stringify(stored()))).toEqual(["fullstack"]);
    expect(storedSuggestedRoles(null)).toEqual([]);
    expect(storedSuggestedRoles("{")).toEqual([]);
    const forged = {
      ...stored(),
      proposal: { ...stored().proposal, suggestedRoles: ["inventada"] },
    };
    expect(storedSuggestedRoles(JSON.stringify(forged))).toEqual([]);
  });
});
