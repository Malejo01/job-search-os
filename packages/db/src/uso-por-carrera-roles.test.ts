import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_KEYS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";

/**
 * La lista de carreras válidas de `admin_usage_by_career()` (rls/0057) está fija en el SQL, igual que la de
 * los cupos de fundador. Si se agrega una carrera a ROLE_KEYS y no se actualiza la función, sus personas
 * caerían en «sin carrera»: este test lo rompe en el CI.
 */
const sql = readFileSync(join(__dirname, "..", "rls", "0057_uso_por_carrera.sql"), "utf8");

describe("uso por carrera: lista de carreras del SQL", () => {
  const block = /v_valid_roles CONSTANT text\[\] := ARRAY\[([^\]]*)\]/.exec(sql)?.[1] ?? "";
  const inSql = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

  it("coincide con ROLE_KEYS, sin faltantes ni sobrantes", () => {
    expect(inSql.length).toBeGreaterThan(0);
    expect([...inSql].sort()).toEqual([...ROLE_KEYS].sort());
  });

  it("no tiene claves repetidas", () => {
    expect(new Set(inSql).size).toBe(inSql.length);
  });
});
