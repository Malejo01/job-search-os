import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { careerPromptSaveQuery, textArray } from "../lib/career-prompt";

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => {
  const { sql, params } = dialect.sqlToQuery(q);
  return { sql, params };
};

describe("arrays de texto en la llamada a career_prompt_save (R32-01)", () => {
  it("un elemento y varios salen como ARRAY[...] con un parámetro cada uno, no como lista entre paréntesis", () => {
    expect(render(textArray(["abogacia"]))).toEqual({
      sql: "ARRAY[$1]::text[]",
      params: ["abogacia"],
    });
    expect(render(textArray(["a", "b"]))).toEqual({
      sql: "ARRAY[$1, $2]::text[]",
      params: ["a", "b"],
    });
  });

  it("la lista vacía es un array vacío válido", () => {
    expect(render(textArray([]))).toEqual({ sql: "ARRAY[]::text[]", params: [] });
  });

  it("la consulta completa arma los tres parámetros y ningún `($n)::text[]`", () => {
    const q = render(careerPromptSaveQuery(["abogacia"], null, []));
    expect(q.sql).toBe(
      "select public.career_prompt_save(ARRAY[$1]::text[], $2::text, ARRAY[]::text[]) as ok",
    );
    expect(q.params).toEqual(["abogacia", null]);
    expect(q.sql).not.toMatch(/\(\$\d+\)::text\[\]/);
  });

  it("«Otra»: sin puestos y con texto", () => {
    const q = render(careerPromptSaveQuery([], "Arquitectura", ["producto_proyectos"]));
    expect(q.sql).toBe(
      "select public.career_prompt_save(ARRAY[]::text[], $1::text, ARRAY[$2]::text[]) as ok",
    );
    expect(q.params).toEqual(["Arquitectura", "producto_proyectos"]);
  });
});
