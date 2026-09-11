import { describe, expect, it } from "vitest";
import {
  listPrompts,
  loadPrompt,
  parseFrontmatter,
  promptFileName,
  renderPrompt,
  templateVars,
} from "./loader";

describe("prompts loader", () => {
  it("mapea ref → archivo", () => {
    expect(promptFileName("evaluate_job@v1")).toBe("evaluate_job.v1.md");
    expect(promptFileName("extract_skills@v12")).toBe("extract_skills.v12.md");
  });

  it("parsea frontmatter plano", () => {
    const parsed = parseFrontmatter("---\nversion: x@v1\ntask: x\n---\nHola {{nombre}}\n");
    expect(parsed?.meta).toEqual({ version: "x@v1", task: "x" });
    expect(parsed?.body).toBe("Hola {{nombre}}\n");
    expect(parseFrontmatter("sin frontmatter")).toBeNull();
  });

  it("carga evaluate_job@v1 real con sus variables", () => {
    const r = loadPrompt("evaluate_job@v1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.task).toBe("evaluate_job");
    expect(r.value.output).toBe("EvaluationSchema");
    expect(templateVars(r.value.template).sort()).toEqual([
      "constraints",
      "criteria",
      "had_full_jd",
      "job",
      "profile_summary",
    ]);
  });

  it("falla con not_found si el prompt no existe", () => {
    const r = loadPrompt("no_existe@v1");
    expect(r).toEqual({ ok: false, error: { kind: "not_found", ref: "no_existe@v1" } });
  });

  it("renderPrompt interpola y falla si falta una variable", () => {
    const prompt = { version: "x@v1" as const, template: "A={{a}} B={{ b }} A2={{a}}" };
    expect(renderPrompt(prompt, { a: 1, b: "dos" })).toEqual({ ok: true, value: "A=1 B=dos A2=1" });
    expect(renderPrompt(prompt, { a: 1 })).toEqual({
      ok: false,
      error: { kind: "missing_var", ref: "x@v1", vars: ["b"] },
    });
  });

  it("lista los prompts del package", () => {
    expect(listPrompts()).toContain("evaluate_job@v1");
    expect(listPrompts()).toContain("evaluate_job@v1.1");
    expect(promptFileName("evaluate_job@v1.1")).toBe("evaluate_job.v1.1.md");
    const r = loadPrompt("evaluate_job@v1.1");
    expect(r.ok && r.value.output).toBe("EvaluationV11Schema");
  });
});
