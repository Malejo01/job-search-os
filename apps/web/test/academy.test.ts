import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fichaWordCount,
  loadAcademyFichas,
  loadApprovedFicha,
  loadApprovedFichas,
  mayReviewAcademy,
  onlyApproved,
  parseFicha,
} from "../lib/academy";

import { AYUDAS_ACADEMY } from "../lib/textos-rediseno";

const WEB = join(__dirname, "..");
const FICHAS_DIR = join(WEB, "content", "academy");

const ficha = (slug: string, estado: string | null) =>
  parseFicha(
    slug,
    `---\ntitulo: Ficha ${slug}\n${estado === null ? "" : `estado: ${estado}\n`}orden: 1\n---\nTexto de la ficha.`,
  );

describe("filtro por estado", () => {
  it("solo se publican las aprobadas", () => {
    const todas = [ficha("a", "aprobada"), ficha("b", "borrador"), ficha("c", "aprobada")].map(
      (f) => f!,
    );
    expect(onlyApproved(todas).map((f) => f.slug)).toEqual(["a", "c"]);
  });

  it("falla cerrado: un estado raro o ausente es borrador", () => {
    expect(ficha("a", "aprobada ")?.estado).toBe("aprobada"); // el espacio se recorta
    expect(ficha("a", "aprobado")?.estado).toBe("borrador");
    expect(ficha("a", "APROBADA")?.estado).toBe("borrador");
    expect(ficha("a", null)?.estado).toBe("borrador");
    expect(onlyApproved([ficha("a", "publicada")!])).toEqual([]);
  });

  it("sin título o con un nombre de archivo raro no hay ficha", () => {
    expect(parseFicha("ok", "---\nestado: aprobada\n---\nTexto")).toBeNull();
    expect(parseFicha("../etc", "---\ntitulo: X\nestado: aprobada\n---\nTexto")).toBeNull();
    expect(parseFicha("Con Mayúsculas", "---\ntitulo: X\n---\nTexto")).toBeNull();
  });

  it("el lector no publica nada mientras todas estén en borrador", () => {
    expect(loadAcademyFichas().length).toBe(17);
    expect(loadApprovedFichas()).toEqual([]);
    expect(loadApprovedFicha("filtro-ats")).toBeNull();
  });
});

describe("control de acceso a los borradores", () => {
  const env = { ADMIN_EMAILS: "admin@example.com", ASSISTANT_TESTER_EMAILS: "tester@example.com" };

  it("admins y testers sí; el resto, no", () => {
    expect(mayReviewAcademy("admin@example.com", env)).toBe(true);
    expect(mayReviewAcademy("TESTER@example.com", env)).toBe(true);
    expect(mayReviewAcademy("otra@example.com", env)).toBe(false);
    expect(mayReviewAcademy(null, env)).toBe(false);
    expect(mayReviewAcademy(undefined, env)).toBe(false);
  });

  it("sin listas configuradas, nadie", () => {
    expect(mayReviewAcademy("admin@example.com", {})).toBe(false);
  });

  it("la pantalla de revisión comprueba el permiso antes de leer las fichas y da 404", () => {
    const src = readFileSync(join(WEB, "app/(app)/settings/academy/page.tsx"), "utf8");
    const guard = src.indexOf("canReviewAcademy(userId)");
    expect(guard).toBeGreaterThan(-1);
    expect(src.indexOf("notFound()")).toBeGreaterThan(guard);
    expect(src.indexOf("loadAcademyFichas()")).toBeGreaterThan(guard);
  });

  it("/academy y su detalle solo leen las aprobadas", () => {
    for (const f of ["app/(app)/academy/page.tsx", "app/(app)/academy/[slug]/page.tsx"]) {
      const src = readFileSync(join(WEB, f), "utf8");
      expect(src, f).not.toMatch(/loadAcademyFichas\(/);
    }
  });
});

describe("las 17 fichas", () => {
  const files = readdirSync(FICHAS_DIR).filter((f) => f.endsWith(".md"));
  const fichas = loadAcademyFichas();

  it("hay 17, todas en borrador", () => {
    expect(files).toHaveLength(17);
    expect(fichas.map((f) => f.estado)).toEqual(Array(17).fill("borrador"));
  });

  it("cada «?» de la app apunta a una ficha que existe (R23-04)", () => {
    const slugs = new Set(fichas.map((f) => f.slug));
    for (const [clave, a] of Object.entries(AYUDAS_ACADEMY)) {
      expect(slugs.has(a.slug), `${clave}: falta la ficha ${a.slug}`).toBe(true);
    }
  });

  it("cada una tiene de 120 a 200 palabras", () => {
    for (const f of fichas) {
      const n = fichaWordCount(f);
      expect(n, `${f.slug}: ${n} palabras`).toBeGreaterThanOrEqual(120);
      expect(n, `${f.slug}: ${n} palabras`).toBeLessThanOrEqual(200);
    }
  });

  it("sin HTML crudo, sin promesas y sin «compatibilidad ATS»", () => {
    for (const file of files) {
      const raw = readFileSync(join(FICHAS_DIR, file), "utf8");
      expect(raw, file).not.toMatch(/<[a-z!/]/i);
      expect(raw, file).not.toMatch(/compatibilidad ATS|te van a contratar|conseguí trabajo/i);
    }
  });

  it("la de monotributo aclara que es información general y no asesoramiento", () => {
    const raw = readFileSync(join(FICHAS_DIR, "dependencia-y-monotributo.md"), "utf8");
    expect(raw).toMatch(/Información general, no es asesoramiento/);
  });
});

describe("el Markdown se renderiza como nodos, no como HTML", () => {
  it("no hay dangerouslySetInnerHTML en Academy", () => {
    for (const f of [
      "app/(app)/academy/page.tsx",
      "app/(app)/academy/[slug]/page.tsx",
      "app/(app)/settings/academy/page.tsx",
      "lib/academy.ts",
    ]) {
      expect(readFileSync(join(WEB, f), "utf8"), f).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("un script en una ficha queda como texto y un enlace peligroso pierde el href", () => {
    const f = parseFicha(
      "x",
      "---\ntitulo: X\n---\n<script>alert(1)</script> [clic](javascript:alert(1))",
    );
    const p = f?.blocks[0];
    expect(p?.type).toBe("paragraph");
    expect(JSON.stringify(p)).not.toContain('"type":"link"');
  });
});
