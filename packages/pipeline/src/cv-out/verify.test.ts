import { describe, expect, it } from "vitest";
import {
  cleanCvText,
  cvHistorySources,
  cvRejectReasons,
  verifyCvBullets,
  verifyCvSummary,
  verifyCvText,
} from "./verify";

const answers = [
  "Trabajé en Empresa A como analista. Armé reportes en Excel y SQL para 12 sucursales.",
  "Bajé el tiempo de cierre un 30%.",
];

describe("cvRejectReasons", () => {
  it("acepta una reescritura que solo usa lo que dijo la persona", () => {
    const g = "Desarrollé reportes en Excel y SQL para 12 sucursales de Empresa A.";
    expect(cvRejectReasons(g, answers)).toEqual([]);
  });

  it("rechaza un número que no estaba", () => {
    expect(cvRejectReasons("Reduje el tiempo de cierre un 45%.", answers)).toContain(
      "number_not_in_answers",
    );
  });

  it("acepta el mismo número con otro separador de miles", () => {
    expect(cvRejectReasons("Atendí 1.500 casos.", ["Atendí 1500 casos"])).toEqual([]);
  });

  it("rechaza un nombre propio inventado, aunque no sea la primera palabra", () => {
    expect(cvRejectReasons("Armé reportes para Empresa B.", answers)).toContain(
      "name_not_in_answers",
    );
  });

  it("no toma como nombre propio la primera palabra de la oración", () => {
    expect(cvRejectReasons("Automaticé reportes. Mejoré el cierre.", answers)).toEqual([]);
  });

  it("rechaza una tecnología con forma de tecnología que no estaba", () => {
    expect(cvRejectReasons("Armé reportes con PostgreSQL.", answers)).toContain(
      "technology_not_in_answers",
    );
    expect(cvRejectReasons("Armé servicios en Node.js.", answers)).toContain(
      "technology_not_in_answers",
    );
  });

  it("rechaza una tecnología en minúsculas si está en el catálogo y no estaba", () => {
    const opts = { knownTerms: ["docker", "excel"] };
    expect(cvRejectReasons("Armé reportes con docker.", answers, opts)).toContain(
      "technology_not_in_answers",
    );
    expect(cvRejectReasons("Armé reportes con excel.", answers, opts)).toEqual([]);
  });

  it("rechaza links, emails, vacío y texto largo", () => {
    expect(cvRejectReasons("Mirá https://x.example/a", answers)).toContain("link_or_email");
    expect(cvRejectReasons("Escribime a persona@example.com", answers)).toContain("link_or_email");
    expect(cvRejectReasons("   ", answers)).toEqual(["empty"]);
    expect(cvRejectReasons("a ".repeat(200), answers)).toContain("too_long");
  });

  it("compara sin acentos ni mayúsculas", () => {
    expect(cvRejectReasons("Usé EXCEL y sql.", ["usé excel y SQL"])).toEqual([]);
  });
});

describe("verifyCvText", () => {
  it("deja el texto generado si pasa", () => {
    const v = verifyCvText("Armé reportes en SQL.", answers, "armé reportes");
    expect(v).toEqual({ text: "Armé reportes en SQL.", origin: "generated", rejected: [] });
  });

  it("cae al texto de la persona, limpio, si el modelo inventa", () => {
    const v = verifyCvText(
      "Lideré 40 personas en Empresa Z.",
      answers,
      "  - armé reportes en excel ver https://x.example ",
    );
    expect(v.origin).toBe("person");
    expect(v.text).toBe("Armé reportes en excel ver");
    expect(v.rejected.length).toBeGreaterThan(0);
  });
});

describe("verifyCvSummary", () => {
  it("admite hasta 600 caracteres", () => {
    const long = "Analista con experiencia en reportes. ".repeat(14).trim();
    expect(long.length).toBeGreaterThan(220);
    expect(long.length).toBeLessThanOrEqual(600);
    expect(verifyCvSummary(long, [long], "x").origin).toBe("generated");
  });
});

describe("verifyCvBullets", () => {
  it("verifica cada viñeta, deduplica y descarta las vacías", () => {
    const out = verifyCvBullets(
      [
        { generated: "Armé reportes en Excel.", person: "armé reportes" },
        { generated: "Armé reportes en Excel.", person: "armé reportes" },
        { generated: "Gestioné 99 clientes.", person: "gestioné clientes" },
        { generated: "", person: "" },
      ],
      answers,
    );
    expect(out.map((o) => [o.text, o.origin])).toEqual([
      ["Armé reportes en Excel.", "generated"],
      ["Gestioné clientes", "person"],
    ]);
  });
});

describe("cleanCvText", () => {
  it("saca marcadores, invisibles, links y emails; colapsa espacios", () => {
    expect(cleanCvText("•  hola​   mundo persona@example.com www.x.com")).toBe("Hola mundo");
  });
  it("corta en palabra al tope", () => {
    const out = cleanCvText("palabra ".repeat(60), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("palabra")).toBe(true);
  });
});

describe("cvHistorySources (R12-4)", () => {
  const proyecto = {
    kind: "proyecto" as const,
    organization: "Proyecto Turnero",
    title: "Desarrolladora frontend",
    startMonth: null,
    endMonth: null,
    bullets: ["Armé el tablero de turnos", "Stack: React, Node.js, PostgreSQL"],
    link: "https://github.com/persona-ficticia/turnero-barrial",
  };
  const sources = cvHistorySources(proyecto);

  it("el nombre y el stack del proyecto cuentan como fuente", () => {
    const g = "Desarrollé el tablero de Proyecto Turnero con React, Node.js y PostgreSQL.";
    expect(cvRejectReasons(g, [])).not.toEqual([]);
    expect(cvRejectReasons(g, sources)).toEqual([]);
    expect(verifyCvText(g, sources, "x").origin).toBe("generated");
  });

  it("el rol y el nombre que solo está en el link también cuentan", () => {
    expect(
      cvRejectReasons("Publiqué Turnero-Barrial como Desarrolladora frontend.", sources),
    ).toEqual([]);
  });

  it("sigue rechazando tecnologías que no están, y el link no se copia al texto", () => {
    expect(cvRejectReasons("Armé Proyecto Turnero con MongoDB.", sources)).toContain(
      "technology_not_in_answers",
    );
    expect(cvRejectReasons(`Demo en ${proyecto.link}`, sources)).toContain("link_or_email");
  });

  it("una entrada sin link da empresa, cargo y viñetas", () => {
    expect(
      cvHistorySources({
        organization: "Empresa A",
        title: "Analista",
        bullets: ["Armé reportes"],
      }),
    ).toEqual(["Empresa A", "Analista", "Armé reportes"]);
  });
});
