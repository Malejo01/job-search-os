import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildDigest,
  buildWelcomeEmail,
  buscarTextoProhibido,
  type ReglaTextoCodigo,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { aplanarTextos } from "../lib/textos-aprobacion";
import * as textos from "../lib/textos-rediseno";

/**
 * R30-01: el glosario del plan R30 a R34 (§3) y las frases prohibidas (regla 2) como test que falla.
 *
 * - Los bloques nuevos de la tanda se revisan en modo estricto.
 * - El resto de `textos-rediseno.ts` y los emails, con las reglas de la tanda. Lo viejo que todavía no se limpió
 *   está en `PENDIENTES_*`: cada entrada tiene dueño y el test falla si la entrada ya no hace falta (se saca de la
 *   lista), así la deuda solo baja.
 * - Las frases de la regla 2 se buscan además en el código de la web (JSX y strings), que es donde se escriben.
 */

const WEB = join(__dirname, "..");

const BLOQUES_NUEVOS = [
  "ESTADO_REQUISITO_TEXTOS",
  "GLOSARIO_TEXTOS",
  "SELLOS_TEXTOS",
  "COMO_CALCULAMOS_TEXTOS",
  "LISTADO_TEXTOS",
  "DETALLE_TEXTOS",
] as const;

type Pendiente = { clave: string; codigo: ReglaTextoCodigo; quien: string };

/** Textos viejos de `textos-rediseno.ts` con un término del glosario. Los limpia el barrido de R34 salvo que diga otra cosa. */
const PENDIENTES_TEXTOS: readonly Pendiente[] = [
  { clave: "PRIMER_USO.steps.0.text", codigo: "match", quien: "R34 (el menú se llama Match)" },
  { clave: "AYUDA_TEXTOS.faqs.4.a.0", codigo: "match", quien: "R34 (el menú se llama Match)" },
];

function hallazgosDe(texto: string, estricto: boolean) {
  return buscarTextoProhibido(texto, { estricto });
}

describe("los bloques nuevos de la tanda cumplen el glosario (modo estricto)", () => {
  const modulo = textos as unknown as Record<string, unknown>;

  it("los bloques existen", () => {
    for (const nombre of BLOQUES_NUEVOS) expect(modulo[nombre], nombre).toBeDefined();
  });

  for (const nombre of BLOQUES_NUEVOS) {
    it(`${nombre} no usa términos prohibidos`, () => {
      const hojas = aplanarTextos({ [nombre]: modulo[nombre] });
      const malos = hojas.flatMap((h) =>
        hallazgosDe(h.valor, true).map((x) => `${h.clave}: ${x.codigo} («${x.fragmento}»)`),
      );
      expect(malos).toEqual([]);
    });
  }
});

describe("el resto de los textos del rediseño", () => {
  const nuevos = new Set<string>(BLOQUES_NUEVOS);
  const hojas = aplanarTextos(textos as unknown as Record<string, unknown>).filter(
    (h) => !nuevos.has(h.grupo),
  );

  it("no dicen frases prohibidas ni términos del glosario fuera de la lista de pendientes", () => {
    const pendientes = new Set(PENDIENTES_TEXTOS.map((p) => `${p.clave}|${p.codigo}`));
    const malos = hojas.flatMap((h) =>
      hallazgosDe(h.valor, false)
        .filter((x) => !pendientes.has(`${h.clave}|${x.codigo}`))
        .map((x) => `${h.clave}: ${x.codigo} («${x.fragmento}»)`),
    );
    expect(malos).toEqual([]);
  });

  it("cada pendiente sigue teniendo el hallazgo (si ya no, se saca de la lista)", () => {
    const vivos = new Set(
      hojas.flatMap((h) => hallazgosDe(h.valor, false).map((x) => `${h.clave}|${x.codigo}`)),
    );
    for (const p of PENDIENTES_TEXTOS)
      expect(vivos.has(`${p.clave}|${p.codigo}`), p.clave).toBe(true);
  });
});

describe("los emails", () => {
  const bienvenida = buildWelcomeEmail({
    displayName: "Persona Ejemplo",
    until: new Date("2026-12-31T12:00:00Z"),
    becado: false,
    appUrl: "https://app.example",
    contactEmail: "contacto@example.com",
    cvEnabled: true,
  });
  const resumen = buildDigest({
    newEvaluated: 4,
    toApply: 2,
    followUps: 1,
    careers: [{ label: "Carrera A", last7d: 37 }],
    frequency: "semanal",
    now: new Date("2026-10-23T12:00:00Z"),
    timeZone: "America/Argentina/Buenos_Aires",
    productName: "Producto",
  });

  it("la bienvenida no dice nada prohibido", () => {
    expect(hallazgosDe(`${bienvenida.subject}\n${bienvenida.text}`, false)).toEqual([]);
  });

  it("el resumen diario y semanal no dice nada prohibido", () => {
    expect(hallazgosDe(`${resumen.subject}\n${resumen.lines.join("\n")}`, false)).toEqual([]);
  });
});

// Código de la web: JSX y strings. Solo las frases de la regla 2 y «Aplicada» como estado, que son lo que se
// escribe a mano en las pantallas (las palabras «match» o «skills» son también nombres de variables).
const CODIGOS_EN_CODIGO: readonly ReglaTextoCodigo[] = [
  "predice_mejores",
  "descartarian",
  "alta_cantidad_candidatos",
  "impide_postular",
];

/** Archivos con una frase de la regla 2 que todavía no se limpió. La tarjeta es de `listado`; el detalle, de `detalle`. */
const PENDIENTES_CODIGO: readonly { archivo: string; codigo: ReglaTextoCodigo; quien: string }[] = [
  {
    archivo: "app/(app)/admin/marca/page.tsx",
    codigo: "impide_postular",
    quien: "R34 (admin, galería de marca)",
  },
  {
    archivo: "app/(app)/admin/marca/componentes/page.tsx",
    codigo: "impide_postular",
    quien: "R34 (admin, galería de marca)",
  },
];

function archivosFuente(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, out);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) out.push(ruta);
  }
  return out;
}

describe("código de la web: frases prohibidas de la regla 2", () => {
  const encontrados = ["app", "components", "lib"].flatMap((d) =>
    archivosFuente(join(WEB, d)).flatMap((ruta) => {
      const archivo = relative(WEB, ruta).replaceAll("\\", "/");
      return buscarTextoProhibido(readFileSync(ruta, "utf8"))
        .filter((h) => CODIGOS_EN_CODIGO.includes(h.codigo))
        .map((h) => ({ archivo, codigo: h.codigo }));
    }),
  );

  it("no aparecen fuera de la lista de pendientes", () => {
    const pendientes = new Set(PENDIENTES_CODIGO.map((p) => `${p.archivo}|${p.codigo}`));
    const nuevos = encontrados
      .filter((e) => !pendientes.has(`${e.archivo}|${e.codigo}`))
      .map((e) => `${e.archivo}: ${e.codigo}`);
    expect(nuevos).toEqual([]);
  });

  it("cada pendiente sigue teniendo la frase (si ya no, se saca de la lista)", () => {
    const vivos = new Set(encontrados.map((e) => `${e.archivo}|${e.codigo}`));
    for (const p of PENDIENTES_CODIGO) {
      expect(vivos.has(`${p.archivo}|${p.codigo}`), `${p.archivo} (${p.quien})`).toBe(true);
    }
  });
});
