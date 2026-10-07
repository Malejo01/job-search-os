import { describe, expect, it } from "vitest";
import { candidatesCacheConfig } from "../../../apps/web/lib/market-cache";

describe("candidatesCacheConfig", () => {
  it("la clave y el tag incluyen el usuario", () => {
    const c = candidatesCacheConfig("usuario-a");
    expect(c.keyParts).toContain("usuario-a");
    expect(c.tags).toEqual(["market-candidates:usuario-a"]);
  });

  it("dos usuarios no comparten clave ni tag", () => {
    const a = candidatesCacheConfig("usuario-a");
    const b = candidatesCacheConfig("usuario-b");
    expect(a.keyParts.join("/")).not.toBe(b.keyParts.join("/"));
    expect(a.tags).not.toEqual(b.tags);
  });

  it("la clave lleva versión y el caché vence en 1 h", () => {
    const c = candidatesCacheConfig("usuario-a");
    expect(c.keyParts.slice(0, 2)).toEqual(["market-candidates", "v1"]);
    expect(c.revalidate).toBe(3600);
  });
});
