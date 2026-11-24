import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAcademyFichas, parseFicha, publishedFichas, sha256Hex } from "../lib/academy";
import { estadoDeRevision } from "../lib/textos-revision";

const WEB = join(__dirname, "..");
const raw = (estado: string, cuerpo = "Texto de la ficha.") =>
  `---\ntitulo: Ficha de prueba\nestado: ${estado}\norden: 1\n---\n${cuerpo}\n`;
const ficha = (estado: string, cuerpo?: string) => parseFicha("una-ficha", raw(estado, cuerpo))!;

describe("huella de una ficha (R26-01)", () => {
  it("es un sha256 y no cambia al aprobar el archivo (la línea estado no cuenta)", () => {
    const f = ficha("borrador");
    expect(f.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(ficha("aprobada").huella).toBe(f.huella);
  });

  it("cambia si cambia el contenido", () => {
    expect(ficha("borrador", "Otro texto.").huella).not.toBe(ficha("borrador").huella);
  });

  it("sha256Hex es el sha256 de siempre", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("publishedFichas: archivo o aprobación en la base con la misma huella", () => {
  it("una aprobación con la misma huella publica; con otra, no (falla cerrado)", () => {
    const f = ficha("borrador");
    expect(publishedFichas([f], new Map([[f.slug, f.huella]]))[0]!.estado).toBe("aprobada");
    expect(publishedFichas([f], new Map([[f.slug, "0".repeat(64)]]))[0]!.estado).toBe("borrador");
    expect(publishedFichas([f], new Map())[0]!.estado).toBe("borrador");
  });

  it("la aprobación de otra ficha no vale para esta", () => {
    const f = ficha("borrador");
    expect(publishedFichas([f], new Map([["otra", f.huella]]))[0]!.estado).toBe("borrador");
  });

  it("el archivo aprobado se publica aunque la base no diga nada", () => {
    expect(publishedFichas([ficha("aprobada")], new Map())[0]!.estado).toBe("aprobada");
  });

  it("no modifica las fichas de entrada", () => {
    const f = ficha("borrador");
    publishedFichas([f], new Map([[f.slug, f.huella]]));
    expect(f.estado).toBe("borrador");
  });
});

describe("estadoDeRevision (pantalla de revisión)", () => {
  const f = ficha("borrador");
  it("sin revisión, sin revisar", () => {
    expect(estadoDeRevision(f, null)).toMatchObject({
      etiqueta: "Borrador",
      motivo: "sin_revision",
    });
  });
  it("aprobada con la misma huella", () => {
    expect(estadoDeRevision(f, { status: "aprobada", contentHash: f.huella })).toMatchObject({
      etiqueta: "Aprobada",
      motivo: "aprobada_en_base",
    });
  });
  it("aprobada pero el texto cambió: borrador y lo dice", () => {
    const r = estadoDeRevision(f, { status: "aprobada", contentHash: "1".repeat(64) });
    expect(r.etiqueta).toBe("Borrador");
    expect(r.detalle).toContain("cambió");
  });
  it("cambios pedidos", () => {
    expect(estadoDeRevision(f, { status: "cambios", contentHash: f.huella }).motivo).toBe(
      "cambios_pedidos",
    );
  });
});

describe("ACADEMY_DIR: solo para los e2e", () => {
  const dirs: string[] = [];
  const saved = { dir: process.env.ACADEMY_DIR, target: process.env.DB_TARGET };
  afterEach(() => {
    if (saved.dir === undefined) delete process.env.ACADEMY_DIR;
    else process.env.ACADEMY_DIR = saved.dir;
    if (saved.target === undefined) delete process.env.DB_TARGET;
    else process.env.DB_TARGET = saved.target;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const fixture = () => {
    const d = mkdtempSync(join(tmpdir(), "academy-"));
    dirs.push(d);
    writeFileSync(join(d, "solo-e2e.md"), raw("borrador"));
    return d;
  };

  it("con la base local lee esa carpeta", () => {
    process.env.ACADEMY_DIR = fixture();
    process.env.DB_TARGET = "local";
    expect(loadAcademyFichas().map((x) => x.slug)).toEqual(["solo-e2e"]);
  });

  it("sin DB_TARGET=local se ignora y se leen las fichas del repo", () => {
    process.env.ACADEMY_DIR = fixture();
    delete process.env.DB_TARGET;
    const slugs = loadAcademyFichas().map((x) => x.slug);
    expect(slugs).not.toContain("solo-e2e");
    expect(slugs.length).toBeGreaterThan(1);
  });

  it("con una carpeta que no existe no hay fichas (no cae a las del repo)", () => {
    process.env.ACADEMY_DIR = join(tmpdir(), "no-existe-academy-xyz");
    process.env.DB_TARGET = "local";
    expect(loadAcademyFichas()).toEqual([]);
  });
});

describe("la acción de revisar", () => {
  const src = readFileSync(join(WEB, "app/(app)/settings/academy/actions.ts"), "utf8");

  it("comprueba el permiso antes de leer o escribir nada", () => {
    const guard = src.indexOf("canReviewAcademy(userId)");
    expect(guard).toBeGreaterThan(-1);
    expect(src.indexOf("notFound()")).toBeGreaterThan(guard);
    expect(src.indexOf("loadAcademyFichas()")).toBeGreaterThan(guard);
    expect(src.indexOf("addReview(")).toBeGreaterThan(guard);
  });

  it("la huella sale de la ficha en el servidor, nunca del formulario", () => {
    expect(src).toContain("huella: ficha.huella");
    expect(src).not.toMatch(/formData\.get\(["'](huella|hash|content_hash)["']\)/);
  });

  it("la base también exige el rol: la función SQL tiene la barrera de admin o tester", () => {
    const sql = readFileSync(
      join(WEB, "..", "..", "packages", "db", "rls", "0065_academy_reviews.sql"),
      "utf8",
    );
    expect(sql).toContain("NOT public.can_review_content()");
    expect(sql).toContain('REVOKE ALL ON "academy_reviews" FROM authenticated');
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.academy_approved_list\(\) TO authenticated/,
    );
  });
});

describe("«?» y Academy leen lo publicado, no solo el archivo", () => {
  it("las tres pantallas usan los lectores con la persona", () => {
    const ctx = readFileSync(join(WEB, "components/context-help.tsx"), "utf8");
    expect(ctx).toContain("loadApprovedFichaFor(");
    for (const f of ["app/(app)/academy/page.tsx", "app/(app)/academy/[slug]/page.tsx"]) {
      expect(readFileSync(join(WEB, f), "utf8"), f).toMatch(/loadApprovedFichas?For\(/);
    }
  });
});
