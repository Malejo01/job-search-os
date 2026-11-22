import { BRAND } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { ES_TITLE } from "../lib/public-og";

describe("bajada de la marca", () => {
  it("la bajada es «Tu asistente de empleabilidad inteligente» y la frase secundaria queda aparte", () => {
    expect(BRAND.tagline).toBe("Tu asistente de empleabilidad inteligente");
    expect(BRAND.taglineSecondary).toBe("Ofertas afines. CV afinado.");
  });

  it("el título público sale de la bajada nueva", () => {
    expect(ES_TITLE).toBe(`${BRAND.name} · Tu asistente de empleabilidad inteligente`);
  });
});
