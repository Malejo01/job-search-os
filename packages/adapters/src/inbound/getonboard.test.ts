import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalUrl } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { formaDelEmail, getonboardParser, GOB_CODIGOS_MOTIVO } from "./getonboard";
import { MAX_REASON_CHARS } from "./motivo";
import { chooseParserName, EMAIL_PARSERS, type InboundEmailContent } from "./parsers";

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/getonboard", name), "utf8");

const SELECCION = fixture("seleccion-dos-empleos.html");
const DESTACADO = fixture("destacado-un-empleo.html");

const email = (
  html: string | null,
  subject: string | null = "Revisa nuestra selección de empleos increíbles para ti 💌",
): InboundEmailContent => ({
  from: "Get on Board <no-reply@getonbrd.com>",
  to: ["u_a0000000@ingest.example.com"],
  subject,
  html,
  text: null,
  receivedAt: new Date("2026-09-20T02:12:42Z"),
});

const parse = (html: string | null) => getonboardParser.parse(email(html));

/** Link de un aviso como lo arma el email: envuelto en el tracker y codificado. */
const trk = (slug: string) =>
  `https://trk0000.r.us-east-1.awstrack.me/L0/https:%2F%2Fwww.getonbrd.com%2Fempleos%2Fprogramacion%2F${slug}%3Futm_content=${slug}%26utm_medium=email_interesting_jobs%26utm_source=gob/1/0/A=473`;

/** Una tarjeta del formato "selección" con los campos que se le pasen. */
const tarjeta = ({
  slug = "puesto-demo-empresa-demo-remote",
  title = "Puesto Demo",
  meta = "Senior | \nFull time",
  company = "Empresa Demo" as string | null,
  salary = "$2000 - 3000\nUSD/mes" as string | null,
  href = trk(slug),
} = {}) => `<div class="job" style="background-color:white;">
<table cellspacing="0"><tr>
<td style="width:85px"><a style="text-decoration:none" href="${href}"><img alt="x" src="https://example.com/logo.png"></a></td>
<td><a style="display:block" href="${href}"><strong style="padding-right: 4px;">${title}</strong>
<span style="color: #A7B7BE">
${meta}
</span>
<br>
<span style="font-size:11px; color: #627884">
${company === null ? "" : `<strong>\n${company}\n</strong>\n<br>`}
${salary === null ? "" : `<span style="color:#009F91">\n${salary}\n</span>`}
</span>
</a></td>
</tr></table>
<a style="margin-bottom: 6px;" href="${href}">Postular
</a></div>`;

const lista = (...cards: string[]) =>
  `<div class="content"><div class="gb-results-list">${cards.join("\n")}</div></div>`;

describe("getonboardParser: formato «selección de empleos» (lista con tarjetas)", () => {
  it("extrae los dos avisos del email real, con todo lo que el email dice", () => {
    const res = parse(SELECCION);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(2);

    const [norte, sur] = res.jobs;
    expect(norte).toMatchObject({
      source: {
        kind: "email_getonboard",
        externalId: "desarrollador-backend-empresa-norte-remote",
        url: "https://www.getonbrd.com/jobs/desarrollador-backend-empresa-norte-remote",
        rawRef: null,
      },
      title: "Desarrollador Backend",
      companyRaw: "Empresa Norte",
      seniority: "Senior",
      contractType: "Full time",
      salaryMinUsd: 2200,
      salaryMaxUsd: 2500,
      salaryPeriod: "mensual",
      salaryNote: "USD/mes según Get on Board",
    });
    expect(sur).toMatchObject({
      title: "Líder de Plataforma",
      companyRaw: "Empresa Sur",
      salaryMinUsd: 3500,
      salaryMaxUsd: 4000,
      source: { externalId: "lider-de-plataforma-empresa-sur-remote" },
    });
  });

  it("no inventa lo que el email no trae: ubicación, países, modalidad, JD, candidatos, fecha", () => {
    const res = parse(SELECCION);
    if (!res.ok) throw new Error(res.reason);
    for (const job of res.jobs) {
      expect(job.countriesAllowed).toBeNull();
      expect(job.locationRaw).toBeNull();
      expect(job.modality).toBe("desconocida");
      expect(job.jdText).toBeNull();
      expect(job.candidatesCount).toBeNull();
      expect(job.postedAt).toBeNull();
      expect(job.weeklyHours).toBeNull();
      expect(job.badges).toEqual([]);
      expect(job.tags).toEqual([]);
    }
  });

  it("la URL del aviso cruza con la del cron de la API (misma URL canónica)", () => {
    const res = parse(SELECCION);
    if (!res.ok) throw new Error(res.reason);
    // La API publica `https://www.getonbrd.com/jobs/<slug>` (links.public_url)
    const api = canonicalUrl(
      "https://www.getonbrd.com/jobs/desarrollador-backend-empresa-norte-remote",
    );
    expect(canonicalUrl(res.jobs[0]!.source.url!)).toEqual(api);
  });

  it("una tarjeta sin salario deja el salario en null", () => {
    const res = parse(lista(tarjeta({ salary: null })));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]).toMatchObject({
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryPeriod: null,
      salaryNote: null,
    });
  });

  it("salario de un solo valor: mínimo y máximo iguales", () => {
    const res = parse(lista(tarjeta({ salary: "$3.000\nUSD/mes" })));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({ salaryMinUsd: 3000, salaryMaxUsd: 3000 });
  });

  it("solo el tipo de contrato, sin seniority: seniority null", () => {
    const res = parse(lista(tarjeta({ meta: "Part time" })));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({ seniority: null, contractType: "Part time" });
  });

  it("seniority de dos palabras y link sin tracker", () => {
    const res = parse(
      lista(
        tarjeta({
          meta: "Semi Senior | Freelance",
          href: "https://www.getonbrd.com/empleos/programacion/puesto-demo-empresa-demo-remote",
        }),
      ),
    );
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({
      seniority: "Semi Senior",
      contractType: "Freelance",
      source: { externalId: "puesto-demo-empresa-demo-remote" },
    });
  });

  it("decodifica entidades en título y empresa", () => {
    const res = parse(lista(tarjeta({ title: "QA &amp; Testing", company: "Demo &amp; Cía" })));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({ title: "QA & Testing", companyRaw: "Demo & Cía" });
  });

  it("el nombre de la fuente es el del email de Get on Board", () => {
    const res = parse(SELECCION);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.source.name).toBe("Get on Board (email)");
  });
});

describe("getonboardParser: formato «empleos destacados»", () => {
  it("extrae el aviso destacado del email real, sin tomar la descripción recortada como JD", () => {
    const res = parse(DESTACADO);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0]).toMatchObject({
      source: {
        kind: "email_getonboard",
        externalId: "fullstack-developer-react-node-js-empresa-oeste-remote",
        url: "https://www.getonbrd.com/jobs/fullstack-developer-react-node-js-empresa-oeste-remote",
      },
      title: "Full-Stack Developer: React & Node.js",
      companyRaw: "Empresa Oeste",
      seniority: "Senior",
      contractType: "Full time",
      salaryMinUsd: null,
      jdText: null,
      countriesAllowed: null,
    });
  });

  it("un email con destacado y lista junta los dos sin repetir avisos", () => {
    const html = DESTACADO.replace(
      '<div class="panel"',
      `${lista(tarjeta(), tarjeta({ slug: "fullstack-developer-react-node-js-empresa-oeste-remote" }))}<div class="panel"`,
    );
    const res = parse(html);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs.map((j) => j.source.externalId)).toEqual([
      "fullstack-developer-react-node-js-empresa-oeste-remote",
      "puesto-demo-empresa-demo-remote",
    ]);
  });
});

describe("getonboardParser: falla cerrado", () => {
  it("sin HTML", () => {
    expect(parse(null)).toEqual({ ok: false, reason: expect.stringContaining("sin HTML") });
  });

  it("sin avisos (solo perks y «ver más empleos»)", () => {
    const html = DESTACADO.replace(/<h4[\s\S]*?<div class="panel"/, '<div class="panel"');
    expect(parse(html)).toEqual({ ok: false, reason: expect.stringContaining("sin avisos") });
  });

  it("una tarjeta sin empresa rechaza el email entero (nada de extracción parcial)", () => {
    const res = parse(lista(tarjeta(), tarjeta({ slug: "otro-remote", company: null })));
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("otro-remote") });
  });

  it("una tarjeta con seniority o contrato desconocido", () => {
    expect(parse(lista(tarjeta({ meta: "Senior | Medio pelo" }))).ok).toBe(false);
    expect(parse(lista(tarjeta({ meta: "" }))).ok).toBe(false);
    expect(parse(lista(tarjeta({ meta: "Gurú | Full time" }))).ok).toBe(false);
    expect(parse(DESTACADO.replace("\nFull time\n", "\nMedio tiempo\n")).ok).toBe(false);
  });

  it("una tarjeta sin título", () => {
    expect(parse(lista(tarjeta({ title: " " }))).ok).toBe(false);
  });

  it("un salario que no se entiende", () => {
    expect(parse(lista(tarjeta({ salary: "a convenir USD/mes" }))).ok).toBe(false);
  });

  it("una tarjeta sin link a un aviso", () => {
    expect(parse(lista(tarjeta({ href: "https://www.getonbrd.com/misempleos" }))).ok).toBe(false);
  });

  it("una tarjeta con otra estructura (sin el bloque de empresa y salario)", () => {
    const html = lista(tarjeta()).replace(
      /<br>\s*<span style="font-size:11px[\s\S]*?<\/a><\/td>/,
      "</a></td>",
    );
    expect(parse(html)).toEqual({
      ok: false,
      reason: expect.stringContaining("estructura de tarjeta desconocida"),
    });
  });

  it("un destacado con más de un separador en el título", () => {
    expect(parse(DESTACADO.replace(" | Senior", " | Remoto | Senior")).ok).toBe(false);
  });

  it("un href mal codificado no rompe: se busca el aviso tal cual", () => {
    const res = parse(
      lista(
        tarjeta({
          href: "https://www.getonbrd.com/empleos/programacion/puesto-demo-remote?x=%E0%A4%A",
        }),
      ),
    );
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.source.externalId).toBe("puesto-demo-remote");
  });

  it("un destacado sin empresa", () => {
    const html = DESTACADO.replace("<strong>Empresa Oeste</strong>", "");
    expect(parse(html).ok).toBe(false);
  });

  it("un destacado con seniority desconocido", () => {
    expect(parse(DESTACADO.replace(" | Senior", " | Gurú")).ok).toBe(false);
  });
});

/** Código con el que empieza un motivo: lo primero que se lee en la cola manual (R32-07). */
const codigoDe = (res: ReturnType<typeof parse>): string => {
  if (res.ok) throw new Error("debía fallar");
  return res.reason.split(":")[0]!;
};

describe("getonboardParser: variantes públicas (R32-07)", () => {
  it("una oferta, varias y una mezcla con y sin sueldo", () => {
    const una = parse(lista(tarjeta()));
    if (!una.ok) throw new Error(una.reason);
    expect(una.jobs).toHaveLength(1);

    const varias = parse(
      lista(
        tarjeta({ slug: "puesto-a-empresa-a-remote", company: "Empresa A" }),
        tarjeta({ slug: "puesto-b-empresa-b-remote", company: "Empresa B", salary: null }),
        tarjeta({
          slug: "puesto-c-empresa-c-remote",
          company: "Empresa C",
          meta: "Junior | Práctica",
        }),
      ),
    );
    if (!varias.ok) throw new Error(varias.reason);
    expect(varias.jobs.map((j) => [j.companyRaw, j.salaryMinUsd, j.contractType])).toEqual([
      ["Empresa A", 2000, "Full time"],
      ["Empresa B", null, "Full time"],
      ["Empresa C", 2000, "Práctica"],
    ]);
  });

  it("R32-08: el sueldo queda también en su moneda original (dólares por mes) y sin sueldo no hay original", () => {
    const con = parse(lista(tarjeta({ salary: "$2200 - 2500\nUSD/mes" })));
    if (!con.ok) throw new Error(con.reason);
    expect(con.jobs[0]!.salaryOriginal).toEqual({
      min: 2200,
      max: 2500,
      currency: "USD",
      period: "mensual",
    });
    const sin = parse(lista(tarjeta({ salary: null })));
    if (!sin.ok) throw new Error(sin.reason);
    expect(sin.jobs[0]!.salaryOriginal ?? null).toBeNull();
  });

  it("montos con separadores: miles con punto o coma, y decimales", () => {
    const monto = (salary: string) => {
      const res = parse(lista(tarjeta({ salary })));
      if (!res.ok) throw new Error(res.reason);
      return [res.jobs[0]!.salaryMinUsd, res.jobs[0]!.salaryMaxUsd];
    };
    expect(monto("$1.200 - 1.500\nUSD/mes")).toEqual([1200, 1500]);
    expect(monto("$1,200 - $1,500\nUSD/mes")).toEqual([1200, 1500]);
    expect(monto("$2.500,50\nUSD/mes")).toEqual([2501, 2501]);
    expect(monto("$2500.5\nUSD/mes")).toEqual([2501, 2501]);
  });

  it("un monto ilegible o un mínimo mayor que el máximo rechaza el email, con el código salario_ilegible", () => {
    for (const salary of ["$2.50.0 USD/mes", "$3000 - 2000 USD/mes", "$1,2,3 USD/mes"]) {
      const res = parse(lista(tarjeta({ salary })));
      expect(res.ok, salary).toBe(false);
      expect(codigoDe(res), salary).toBe("salario_ilegible");
    }
  });

  it("el HTML cambiado deja un motivo con código y una pista de qué parte cambió", () => {
    // 1. Renombran la clase de las tarjetas: hay links a avisos pero ninguna tarjeta conocida.
    const sinClase = lista(tarjeta()).replace('class="job"', 'class="oferta"');
    const r1 = parse(sinClase);
    expect(codigoDe(r1)).toBe("sin_avisos");
    if (r1.ok) throw new Error("debía fallar");
    expect(r1.reason).toMatch(/tarjetas 0, destacados 0, links [1-9]/);

    // 2. Cambian el texto del botón.
    const r2 = parse(lista(tarjeta()).replace(">Postular", ">Aplicar ahora"));
    expect(codigoDe(r2)).toBe("tarjeta_sin_postular");
    if (r2.ok) throw new Error("debía fallar");
    expect(r2.reason).toContain("tarjeta 1");

    // 3. Cambian <strong> por <b> en la tarjeta.
    const r3 = parse(lista(tarjeta()).replace(/<(\/?)strong/g, "<$1b"));
    expect(codigoDe(r3)).toBe("tarjeta_estructura");

    // 4. Los destacados pasan de <h1> a <h2>.
    const r4 = parse(DESTACADO.replace(/<(\/?)h1/g, "<$1h2"));
    expect(codigoDe(r4)).toBe("sin_avisos");
    if (r4.ok) throw new Error("debía fallar");
    expect(r4.reason).toMatch(/destacados 0, links [1-9]/);
  });

  it("un email sin avisos de verdad (solo perks) dice cero links a avisos", () => {
    const html = DESTACADO.replace(/<h4[\s\S]*?<div class="panel"/, '<div class="panel"');
    const res = parse(html);
    if (res.ok) throw new Error("debía fallar");
    expect(res.reason).toMatch(/tarjetas 0, destacados 0, links 0/);
  });

  it("todo motivo empieza con un código conocido y no pasa de 120 caracteres", () => {
    const casos = [
      parse(null),
      parse(lista(tarjeta({ company: null }))),
      parse(lista(tarjeta({ meta: "Gurú | Full time" }))),
      parse(lista(tarjeta({ meta: "Senior | Medio pelo" }))),
      parse(lista(tarjeta({ title: " " }))),
      parse(lista(tarjeta({ salary: "a convenir USD/mes" }))),
      parse(lista(tarjeta({ href: "https://www.getonbrd.com/misempleos" }))),
      parse(DESTACADO.replace(" | Senior", " | Remoto | Senior")),
      parse(DESTACADO.replace("<strong>Empresa Oeste</strong>", "")),
      parse("x".repeat(2_000_000)),
      parse("<p>nada</p>"),
    ];
    for (const res of casos) {
      if (res.ok) throw new Error("debía fallar");
      expect(GOB_CODIGOS_MOTIVO as readonly string[]).toContain(codigoDe(res));
      expect(res.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    }
  });

  it("el motivo de un contrato desconocido nombra el valor que no se entendió", () => {
    const res = parse(lista(tarjeta({ meta: "Senior | Medio pelo" })));
    if (res.ok) throw new Error("debía fallar");
    expect(codigoDe(res)).toBe("contrato_desconocido");
    expect(res.reason).toContain("Medio pelo");
  });

  it("formaDelEmail cuenta y no devuelve texto", () => {
    const f = formaDelEmail(lista(tarjeta(), tarjeta({ slug: "otro-remote" })));
    expect(f).toEqual({ tarjetas: 2, destacados: 0, linksAAvisos: expect.any(Number) });
    expect(JSON.stringify(f)).not.toContain("Puesto Demo");
  });
});

describe("despacho", () => {
  it("los emails de Get on Board van a este parser", () => {
    expect(chooseParserName("Get on Board <no-reply@getonbrd.com>")).toBe("getonboard");
    expect(EMAIL_PARSERS.getonboard).toBe(getonboardParser);
  });

  it("el genérico sigue sin registrarse: lo desconocido va a la cola manual como «sin parser»", () => {
    expect(EMAIL_PARSERS.generic).toBeUndefined();
  });
});
