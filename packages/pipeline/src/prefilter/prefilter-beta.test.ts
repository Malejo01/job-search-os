import { describe, expect, it } from "vitest";
import adversarial from "../../../../evals/fixtures/adversarial.json";
import golden from "../../../../evals/fixtures/golden.json";
import criteria from "../../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "../criteria";
import type { RoleKey } from "../skills/self-assessment";
import { prefilter, ROLE_OWN_TITLE_PHRASES, type PrefilterResult } from "./prefilter";
import { prefilterReasonText } from "./reason-text";

/**
 * Arreglos del prefiltro para las carreras de la beta (C1-4, ADR-027). Todo inventado. Las reglas del
 * ejemplo bloquean «manager», que es el caso que pide los cargos propios del oficio.
 */
const rules = criteria as CriteriaRules;
const run = (title: string, targetRoles?: RoleKey[], extra: Record<string, unknown> = {}) =>
  prefilter(
    { title, modality: "remoto", locationRaw: "Remoto", ...extra },
    rules,
    targetRoles ? { targetRoles } : {},
  );
const passes = (r: PrefilterResult) => r.pass;

describe("exemptFor de «abogad» y «administrativ»", () => {
  it.each(["Abogado/a Corporativo", "Abogada Laboralista", "Estudio jurídico busca abogados"])(
    "%s pasa para quien eligió abogacia y descarta sin la carrera",
    (title) => {
      expect(passes(run(title, ["abogacia"]))).toBe(true);
      expect(run(title)).toMatchObject({ pass: false, reason: "disciplina_distinta" });
      expect(run(title, ["finanzas_contabilidad"])).toMatchObject({ pass: false });
    },
  );

  it.each(["Analista Administrativo", "Administrativa Contable", "Responsable administrativo/a"])(
    "%s pasa para administración de empresas, contaduría y asistencia, y descarta sin carrera",
    (title) => {
      expect(passes(run(title, ["administracion_empresas"]))).toBe(true);
      expect(passes(run(title, ["finanzas_contabilidad"]))).toBe(true);
      expect(passes(run(title, ["asistencia_operaciones"]))).toBe(true);
      expect(run(title)).toMatchObject({ pass: false, reason: "disciplina_distinta" });
      expect(passes(run(title, ["abogacia"]))).toBe(false);
    },
  );

  it("una señal IT sigue salvando al título, como antes", () => {
    expect(passes(run("Desarrollador Full Stack para área administrativa"))).toBe(true);
  });
});

describe("cargos propios que dicen «manager»", () => {
  it.each([
    ["Brand Manager", "marketing_digital"],
    ["Assistant Brand Manager", "marketing_digital"],
    ["PR Manager", "marketing_digital"],
    ["Communications Manager", "marketing_digital"],
    ["Communications Manager", "comunicacion"],
    ["PR Manager", "comunicacion"],
    ["Legal Manager", "abogacia"],
  ] as [string, RoleKey][])("%s pasa para %s y se bloquea sin ella", (title, role) => {
    expect(passes(run(title, [role]))).toBe(true);
    expect(run(title)).toMatchObject({ pass: false, reason: "titulo_blocklist" });
    expect(run(title, ["backend"])).toMatchObject({ pass: false, reason: "titulo_blocklist" });
  });

  it("la frase libera «manager», no el resto de la blocklist ni otras carreras", () => {
    expect(run("Brand Manager Lead", ["marketing_digital"])).toMatchObject({ pass: false });
    expect(run("Director de Brand Manager", ["marketing_digital"])).toMatchObject({ pass: false });
    expect(run("Brand Manager", ["abogacia"])).toMatchObject({ pass: false });
    expect(run("Legal Manager", ["marketing_digital"])).toMatchObject({ pass: false });
    expect(run("Operations Manager", ["marketing_digital"])).toMatchObject({ pass: false });
  });

  it("no cambia lo que ya estaba", () => {
    expect(ROLE_OWN_TITLE_PHRASES.marketing_digital).toEqual(
      expect.arrayContaining(["marketing manager", "community manager"]),
    );
    expect(passes(run("Marketing Manager", ["marketing_digital"]))).toBe(true);
  });
});

describe("licencia: alias de Argentina", () => {
  const jd = (text: string) => ({ jdText: text });
  const withCountry = (country: string, text: string) =>
    prefilter({ title: "Abogado", modality: "remoto", locationRaw: "Remoto", ...jd(text) }, rules, {
      userCountry: country,
      targetRoles: ["abogacia"],
    });

  it.each([
    "Matrícula profesional vigente en el CPACF.",
    "Se requiere matrícula profesional, inscripto en el Colegio Público de Abogados de la Capital Federal.",
  ])("«%s» es de Argentina: pasa con flag para un perfil AR", (text) => {
    const r = withCountry("AR", text);
    expect(r.pass).toBe(true);
    if (r.pass) expect(r.flags.some((f) => f.startsWith("licencia_profesional"))).toBe(true);
  });

  it("y descarta para un perfil de otro país", () => {
    expect(withCountry("MX", "Matrícula profesional vigente en el CPACF.")).toMatchObject({
      pass: false,
      reason: "licencia_profesional",
    });
  });

  it.each([
    "Matrícula profesional vigente en el Colegio de Abogados de Lima.",
    "Matrícula profesional del Colegio de Abogados de Madrid (ICAM).",
    "Matrícula profesional en el Colegio de Abogados.",
  ])("«%s» no es de Argentina: descarta para un perfil AR", (text) => {
    expect(withCountry("AR", text)).toMatchObject({ pass: false, reason: "licencia_profesional" });
  });

  it("sin el país de la persona sigue sin correr (falla abierta)", () => {
    const r = prefilter(
      { title: "Abogado", modality: "remoto", jdText: "Matrícula profesional en el CPACF." },
      rules,
      { userCountry: null, targetRoles: ["abogacia"] },
    );
    expect(r.pass).toBe(true);
  });
});

describe("multinivel", () => {
  it.each([
    "Sé tu propio jefe",
    "Asesor comercial: sé tu propia jefa",
    "Ser tu propio jefe desde casa",
    "Sea su propio jefe",
    "Oportunidad de negocio sin experiencia",
    "Ingresos extra desde casa",
    "Ingresos extras trabajando online",
    "Ganancias extra mensuales",
    "Emprendedor independiente",
    "Emprendedor/a independiente",
    "Emprendedor(a) independiente",
    "Emprendedora independiente de belleza",
    "Network marketing: sumate al equipo",
    "Representante multinivel",
    "Emprendé tu propio negocio",
    "Be your own boss",
    "Earn extra income from home",
  ])("el título «%s» descarta con cualquier carrera", (title) => {
    for (const roles of [undefined, ["abogacia"], ["marketing_digital"], ["ventas_b2b"]] as
      RoleKey[][] | undefined[]) {
      expect(run(title, roles), title).toMatchObject({
        pass: false,
        reason: "disciplina_distinta",
      });
    }
  });

  it("el detalle nombra la frase y el mensaje al usuario lo dice claro", () => {
    const r = run("Sé tu propio jefe");
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.detail).toContain("tu propio jefe");
      expect(prefilterReasonText(`${r.reason}: ${r.detail}`)).toMatch(/multinivel/);
    }
  });

  describe("en el texto del aviso hace falta una frase de núcleo y otra más, o cuatro distintas", () => {
    const jd = (text: string, title = "Asesor comercial", roles?: RoleKey[]) =>
      run(title, roles, { jdText: text });

    it("una sola frase, o varias comunes sin núcleo, no alcanzan", () => {
      for (const text of [
        "Buscamos asesores. Es una oportunidad de negocio para la empresa.",
        "Ingresos extra. Más ingresos extra. Ingresos extra otra vez.",
        "Identificá cada oportunidad de negocio. Comisiones: ingresos extra por objetivos.",
        "Trabajamos con emprendedores independientes. Una oportunidad de negocio para nuestros clientes.",
        "Ingresos extra por horas extras y emprendedores independientes como clientes.",
      ]) {
        expect(jd(text).pass, text).toBe(true);
      }
    });

    it("«propio jefe de proyecto» o de equipo es un cargo, no el eslogan", () => {
      expect(
        jd("Serás tu propio jefe de proyecto. Una oportunidad de negocio con ingresos extra.").pass,
      ).toBe(true);
    });

    it("el eslogan más otra frase descarta", () => {
      expect(
        jd("Sé tu propio jefe y generá ingresos extra con nuestra oportunidad de negocio."),
      ).toMatchObject({ pass: false, reason: "disciplina_distinta" });
      expect(jd("Sé tu propia jefa. Ganancias extra desde el primer mes.").pass).toBe(false);
      expect(jd("Network marketing con ingresos extra.").pass).toBe(false);
    });

    it("cuatro frases distintas descartan aunque ninguna sea de núcleo", () => {
      expect(
        jd(
          "Una oportunidad de negocio para emprendedores independientes. Ingresos extra y extra income.",
        ).pass,
      ).toBe(false);
    });

    it("un título de tecnología no se descarta por el texto", () => {
      expect(jd("Sé tu propio jefe y generá ingresos extra.", "Backend Developer").pass).toBe(true);
    });
  });

  it.each([
    "Ejecutivo Comercial (oportunidades de negocio)",
    "Analista de Oportunidades de Negocio",
    "Emprendedores y Startups Community Manager",
    "Jefe de Ingresos y Cobranzas",
    "Revenue Operations",
    "Propio Jefe de Obra",
    "Desarrollador Backend independiente",
    "Líder de Proyecto, jefe de equipo",
  ])("no descarta «%s»", (title) => {
    expect(run(title, ["administracion_empresas", "marketing_digital"]).pass).toBe(true);
  });
});

describe("golden y adversarial", () => {
  type FixtureJob = { titulo: string; ubicacion_raw: string; modalidad: string; jd?: string };
  const jobs = [...golden.jobs, ...adversarial.jobs] as FixtureJob[];

  it("la regla de multinivel no toca ningún aviso del golden ni del adversarial", () => {
    expect(jobs.length).toBeGreaterThan(30);
    for (const j of jobs) {
      for (const jdText of [null, j.jd ?? null]) {
        const r = prefilter(
          {
            title: j.titulo,
            locationRaw: j.ubicacion_raw,
            modality: j.modalidad as "remoto",
            jdText,
          },
          rules,
        );
        if (!r.pass) expect(r.detail, j.titulo).not.toContain("multinivel");
      }
    }
  });

  it("las carreras de la beta no cambian el resultado de ningún aviso del golden ni del adversarial", () => {
    const roles: RoleKey[][] = [
      ["abogacia"],
      ["administracion_empresas"],
      ["comunicacion"],
      ["relaciones_internacionales"],
    ];
    for (const j of jobs) {
      const input = {
        title: j.titulo,
        locationRaw: j.ubicacion_raw,
        modality: j.modalidad as "remoto",
      };
      const base = JSON.stringify(prefilter(input, rules));
      for (const targetRoles of roles) {
        expect(JSON.stringify(prefilter(input, rules, { targetRoles })), j.titulo).toBe(base);
      }
    }
  });
});
