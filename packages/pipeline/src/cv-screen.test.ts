import { describe, expect, it } from "vitest";
import type { CvMissing, CvSection, CvSectionId } from "./cv-out/model";
import { cvScreen, CV_PENDING_ORDER } from "./cv-screen";

const sec = (id: CvSectionId): CvSection => ({
  id,
  title: id,
  blocks: [{ heading: "Algo", detail: null, bullets: [] }],
});
const emptySec = (id: CvSectionId): CvSection => ({ id, title: id, blocks: [] });

const ALL: CvSectionId[] = ["summary", "experience", "education", "skills", "languages"];
const doc = (ids: CvSectionId[], missing: CvMissing[] = []) => ({
  sections: ids.map(sec),
  missing,
});

describe("cvScreen · los tres estados de «Tu CV»", () => {
  it("sin nada cargado: «empty», todo pendiente y solo los dos caminos", () => {
    const r = cvScreen(
      doc([], ["summary", "experience", "education", "skills", "languages", "links"]),
    );
    expect(r.state).toBe("empty");
    expect(r.pending).toEqual([...CV_PENDING_ORDER]);
    expect(r.showDoor).toBe(true);
  });

  it("secciones sin bloques cuentan como nada cargado", () => {
    const r = cvScreen({ sections: ALL.map(emptySec), missing: [] });
    expect(r.state).toBe("empty");
  });

  it("con datos parciales: «partial», sin la puerta y con lo que falta en orden", () => {
    const r = cvScreen(doc(["experience", "skills"]));
    expect(r.state).toBe("partial");
    expect(r.showDoor).toBe(false);
    expect(r.pending).toEqual(["summary", "education", "languages"]);
  });

  it("un solo dato ya es parcial (borde con «empty»)", () => {
    expect(cvScreen(doc(["languages"])).state).toBe("partial");
  });

  it("falta un solo ítem: sigue parcial (borde con «complete»)", () => {
    const r = cvScreen(doc(["summary", "experience", "education", "skills"]));
    expect(r.state).toBe("partial");
    expect(r.pending).toEqual(["languages"]);
  });

  it("con las cinco secciones: «complete», sin pendientes", () => {
    const r = cvScreen(doc(ALL));
    expect(r.state).toBe("complete");
    expect(r.pending).toEqual([]);
    expect(r.showDoor).toBe(false);
  });

  it("los links no bloquean el estado completo", () => {
    expect(cvScreen(doc(ALL, ["links"])).state).toBe("complete");
  });

  it("proyectos valen como experiencia para quien recién empieza", () => {
    const r = cvScreen(doc(["summary", "projects", "education", "skills", "languages"]));
    expect(r.state).toBe("complete");
    expect(r.pending).not.toContain("experience");
  });

  it("certificaciones sueltas no reemplazan a educación", () => {
    const r = cvScreen(doc(["summary", "experience", "certifications", "skills", "languages"]));
    expect(r.pending).toEqual(["education"]);
  });

  it("sin documento (sin perfil): «empty»", () => {
    expect(cvScreen(null).state).toBe("empty");
  });
});

describe("cvScreen · borrador sin confirmar", () => {
  it("avisa del borrador en cualquier estado, sin cambiar el estado", () => {
    for (const ids of [[], ["experience"], ALL] as CvSectionId[][]) {
      const without = cvScreen(doc(ids));
      const withDraft = cvScreen(doc(ids), { hasDraft: true });
      expect(without.showDraftNotice).toBe(false);
      expect(withDraft.showDraftNotice).toBe(true);
      expect(withDraft.state).toBe(without.state);
      expect(withDraft.pending).toEqual(without.pending);
    }
  });

  it("con borrador y sin nada confirmado, la puerta sigue (el borrador no es un dato)", () => {
    expect(cvScreen(doc([]), { hasDraft: true }).showDoor).toBe(true);
  });

  it("es determinista y no muta la entrada", () => {
    const d = doc(["experience"]);
    const before = JSON.stringify(d);
    expect(cvScreen(d)).toEqual(cvScreen(d));
    expect(JSON.stringify(d)).toBe(before);
  });
});
