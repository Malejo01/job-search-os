import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { auditarLegibilidad, type CodigoLegibilidad } from "../lib/legibilidad";

/**
 * R30-12: la regla de legibilidad como test que falla (plan R30 a R34 §9, `docs/ux/legibilidad.md`).
 *
 * - Las pantallas de ofertas (listado, tarjeta, detalle y evaluación) van en modo estricto: sin tamaños menores a
 *   12 px, sin colores de texto fuera de la lista y sin transparencias.
 * - El resto de las pantallas de usuario está en `EXCEPCIONES`: cuántos hallazgos tiene cada archivo hoy. El número
 *   solo puede bajar (R33 y R34 lo van vaciando) y un archivo que no figura tiene que dar 0.
 * - El admin y lo que emula papel o es una imagen están excluidos, cada uno con su motivo.
 */

const WEB = join(__dirname, "..");

/** Lo que no se mide, con el motivo. */
const EXCLUIDOS: readonly { prefijo: string; motivo: string }[] = [
  { prefijo: "app/(app)/admin/", motivo: "el admin va después de abrir (plan §9)" },
  {
    prefijo: "components/cv-preview.tsx",
    motivo: "emula una hoja de papel: fondo blanco y texto oscuro fijos",
  },
  { prefijo: "app/global-error.tsx", motivo: "página de error con su propio CSS, sin Tailwind" },
];

/** Pantallas de ofertas: modo estricto. */
function esPantallaDeOfertas(archivo: string): boolean {
  if (archivo.startsWith("app/(app)/jobs/")) {
    return (
      !archivo.startsWith("app/(app)/jobs/new/") &&
      !archivo.startsWith("app/(app)/jobs/pending-jd/")
    );
  }
  return [
    "components/offer-card.tsx",
    "components/offer-d3.tsx",
    "components/requisitos-del-aviso.tsx",
    "components/affinity-seal-link.tsx",
    "components/ui/seal.tsx",
    "components/ui/chip.tsx",
  ].includes(archivo);
}

/**
 * Hallazgos que todavía tienen las pantallas de ofertas. Se vacía al aplicar la regla (R30-12): `listado` y
 * `detalle` terminan sus pantallas y después se corrige lo que quede. Mientras tanto solo puede bajar.
 */
const PENDIENTES_OFERTAS: Readonly<Record<string, number>> = {};

/** Hallazgos del resto de las pantallas de usuario. Solo pueden bajar; R33 (CV) y R34 (el resto) los vacían. */
const EXCEPCIONES: Readonly<Record<string, number>> = {
  "app/(app)/inbox/bulk-bar.tsx": 1,
  "app/(app)/inbox/page.tsx": 1,
  "app/(app)/plan/si-aprendes.tsx": 1,
  "app/(app)/settings/criteria/save-button.tsx": 1,
  "app/components/guarded-form.tsx": 1,
  "app/components/submit-button.tsx": 1,
  "app/terminos-actualizados/form.tsx": 1,
  "components/brand/illustration.tsx": 1,
  "components/guided-tour.tsx": 1,
  "components/primer-uso.tsx": 1,
  "components/profile-agent/cards.tsx": 1,
  "components/specialty-chips-toggle.tsx": 4,
};

function archivos(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, out);
    else if (/\.tsx$/.test(nombre)) out.push(ruta);
  }
  return out;
}

const medidos = ["app", "components"]
  .flatMap((d) => archivos(join(WEB, d)))
  .map((ruta) => relative(WEB, ruta).replaceAll("\\", "/"))
  .filter((a) => !EXCLUIDOS.some((e) => a.startsWith(e.prefijo)));

const hallazgos = new Map(
  medidos.map((a) => [a, auditarLegibilidad(readFileSync(join(WEB, a), "utf8"))] as const),
);

const cuenta = (a: string) => hallazgos.get(a)?.length ?? 0;

describe("auditarLegibilidad", () => {
  const codigos = (src: string): CodigoLegibilidad[] =>
    auditarLegibilidad(src).map((h) => h.codigo);

  it("tamaños: debajo de 12 px falla; desde 12 px pasa", () => {
    expect(codigos('<p className="text-[11px]">')).toEqual(["tamano_menor_12"]);
    expect(codigos('<p className="text-[8px] sm:text-[9px]">')).toEqual([
      "tamano_menor_12",
      "tamano_menor_12",
    ]);
    expect(codigos('<p className="text-[0.6875rem]">')).toEqual(["tamano_menor_12"]);
    expect(codigos('<p className="text-[12px]">')).toEqual([]);
    expect(codigos('<p className="text-xs text-sm text-base text-[13px] text-[0.75rem]">')).toEqual(
      [],
    );
    expect(codigos("<p style={{ fontSize: 11 }}>")).toEqual(["tamano_menor_12"]);
    expect(codigos("<p style={{ fontSize: 14 }}>")).toEqual([]);
  });

  it("colores: solo los tokens; la paleta y los colores sueltos fallan", () => {
    expect(codigos('<p className="text-fg text-fg-muted text-fg-subtle text-brand-text">')).toEqual(
      [],
    );
    expect(codigos('<p className="text-zinc-500">')).toEqual(["color_fuera_de_lista"]);
    expect(codigos('<p className="text-white">')).toEqual(["color_fuera_de_lista"]);
    expect(codigos('<p className="text-[#333]">')).toEqual(["color_fuera_de_lista"]);
    expect(codigos('<p className="text-[var(--jso-fg)]">')).toEqual(["color_fuera_de_lista"]);
    expect(codigos('<p className="dark:text-red-800">')).toEqual(["color_fuera_de_lista"]);
    expect(codigos('<p className="text-surface">')).toEqual(["color_fuera_de_lista"]);
  });

  it("alineación y corte de línea no son colores", () => {
    expect(codigos('<p className="text-center text-left text-balance text-ellipsis">')).toEqual([]);
  });

  it("transparencia: un color de texto con /NN y un opacity-NN fallan", () => {
    expect(codigos('<p className="text-fg/70">')).toEqual(["texto_transparente"]);
    expect(codigos('<p className="text-fg-muted/80">')).toEqual(["texto_transparente"]);
    expect(codigos('<p className="opacity-60">')).toEqual(["opacidad"]);
    expect(codigos('<p className="opacity-100">')).toEqual([]);
    // Oculto del todo: no hay texto que leer
    expect(codigos('<p className="opacity-0 focus:opacity-100">')).toEqual([]);
    expect(codigos('<p className="bg-brand/20 border-line/50">')).toEqual([]);
  });

  it("informa la línea y el fragmento", () => {
    const [h] = auditarLegibilidad('a\nb\n<p className="text-[10px]">');
    expect(h).toEqual({ codigo: "tamano_menor_12", linea: 3, fragmento: "text-[10px]" });
  });
});

describe("las pantallas cumplen la regla", () => {
  it("hay archivos que medir y las pantallas de ofertas están entre ellos", () => {
    expect(medidos.length).toBeGreaterThan(100);
    expect(medidos.filter(esPantallaDeOfertas).length).toBeGreaterThan(10);
    expect(medidos).toContain("components/ui/seal.tsx");
  });

  it("ningún archivo tiene más hallazgos que los anotados (los que no figuran, cero)", () => {
    const de = (a: string) =>
      esPantallaDeOfertas(a) ? (PENDIENTES_OFERTAS[a] ?? 0) : (EXCEPCIONES[a] ?? 0);
    const mal = medidos
      .filter((a) => cuenta(a) > de(a))
      .map((a) => {
        const detalle = (hallazgos.get(a) ?? [])
          .slice(0, 4)
          .map((h) => `${h.codigo} línea ${h.linea} «${h.fragmento}»`)
          .join("; ");
        return `${a}: ${cuenta(a)} (anotados ${de(a)}) · ${detalle}`;
      });
    expect(mal).toEqual([]);
  });

  it("las excepciones del resto de las pantallas siguen siendo ciertas (si bajan, se anota el número nuevo)", () => {
    const mal = Object.entries(EXCEPCIONES)
      .filter(([a, n]) => cuenta(a) !== n)
      .map(([a, n]) => `${a}: anotado ${n}, hoy ${cuenta(a)}`);
    expect(mal).toEqual([]);
  });

  it("las pendientes de ofertas solo nombran archivos de ofertas que existen", () => {
    for (const a of Object.keys(PENDIENTES_OFERTAS)) {
      expect(esPantallaDeOfertas(a), a).toBe(true);
      expect(hallazgos.has(a), a).toBe(true);
    }
    for (const a of Object.keys(EXCEPCIONES)) {
      expect(esPantallaDeOfertas(a), a).toBe(false);
      expect(hallazgos.has(a), a).toBe(true);
    }
  });
});
