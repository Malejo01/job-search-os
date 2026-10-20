import { describe, expect, it } from "vitest";
import { detectResidencyRestriction } from "./residency";

const detect = (text: string | null, country: string | null = "AR") =>
  detectResidencyRestriction(text, country);

describe("detectResidencyRestriction", () => {
  describe("restringe", () => {
    it.each([
      ["Must be based in Canada", ["CA"]],
      ["Candidates must be located in the United States", ["US"]],
      ["Only candidates residing in the UK", ["GB"]],
      ["You must be a resident of Germany", ["DE"]],
      ["Applicants must be living in France.", ["FR"]],
      ["You must reside in Spain to apply", ["ES"]],
      ["Must live in Ireland", ["IE"]],
      ["Open only to candidates based in Australia", ["AU"]],
      ["Open to applicants located in New Zealand", ["NZ"]],
      ["Only residents of Portugal may apply", ["PT"]],
      ["Must be based in the U.S.", ["US"]],
      ["Debes residir en España", ["ES"]],
      ["Deben vivir en Chile", ["CL"]],
      ["Debes estar radicado en Estados Unidos", ["US"]],
      ["Solo para personas que residan en Canadá", ["CA"]],
      ["Solo candidatos radicados en México", ["MX"]],
      ["This role is based in Canada only", ["CA"]],
      ["Remote (US only)", ["US"]],
    ])("%s", (text, countries) => {
      const r = detect(text);
      expect(r?.countries).toEqual(countries);
      expect(r?.phrase.length).toBeGreaterThan(0);
    });

    it("varios países en la lista", () => {
      const r = detect("Candidates must be located in Canada or the United States.");
      expect(r?.countries).toEqual(["CA", "US"]);
    });

    it("región: 'EU only'", () => {
      const r = detect("Remote - EU only");
      expect(r?.regions).toEqual(["EU"]);
      expect(r?.countries).toEqual([]);
    });

    it("región: 'must be based in Europe'", () => {
      expect(detect("Must be based in Europe")?.regions).toEqual(["EU"]);
    });

    it("corta la lista donde termina la oración", () => {
      const r = detect("Must be based in Canada. We also hire contractors in Argentina.");
      expect(r?.countries).toEqual(["CA"]);
    });

    it("corta en una cláusula nueva: 'with overlap' no oculta el país", () => {
      const r = detect("You must be based in Canada with overlap with EST hours");
      expect(r?.countries).toEqual(["CA"]);
    });

    it("lee el título y la ubicación cuando vienen en el mismo texto", () => {
      const text = "Senior Data Analyst\nRemote - Canada only\nWe build things";
      expect(detect(text)?.countries).toEqual(["CA"]);
    });

    it("una frase que admite a la persona manda sobre otra que no", () => {
      const text = "Must be based in Canada.\nOpen to candidates located in LATAM.";
      expect(detect(text)).toBeNull();
    });
  });

  describe("no restringe", () => {
    it.each([
      "Work authorization in the US is a plus",
      "Our HQ is located in Canada",
      "We have offices in London",
      "Must overlap with US hours",
      "Candidates in the US or LATAM",
    ])("%s", (text) => {
      expect(detect(text)).toBeNull();
    });

    it("la lista incluye al país de la persona", () => {
      expect(detect("Must be based in Argentina")).toBeNull();
      expect(detect("Candidates must be located in Canada or Argentina")).toBeNull();
      expect(detect("Debes residir en Argentina")).toBeNull();
    });

    it("LATAM incluye AR", () => {
      expect(detect("Must be based in LATAM")).toBeNull();
      expect(detect("Only candidates residing in Latin America")).toBeNull();
    });

    it("Americas incluye AR", () => {
      expect(detect("Must be located in the Americas")).toBeNull();
    });

    it("anywhere y global incluyen a todos", () => {
      expect(detect("Must be based anywhere in the world")).toBeNull();
      expect(detect("Must be located in anywhere")).toBeNull();
      expect(detect("Open to candidates based in worldwide locations")).toBeNull();
      expect(detect("Remote - global only")).toBeNull();
    });

    it("la región del perfil MX tampoco restringe LATAM", () => {
      expect(detect("Must be based in LATAM", "MX")).toBeNull();
    });

    it("otro perfil sí queda afuera: un perfil de Canadá no se restringe con 'Canada'", () => {
      expect(detect("Must be based in Canada", "CA")).toBeNull();
      expect(detect("Must be based in Canada", "MX")?.countries).toEqual(["CA"]);
    });

    it("falla abierto ante lo que no entiende", () => {
      expect(detect("Must be based in Narnia")).toBeNull();
      expect(detect("Must be based in")).toBeNull();
      expect(detect("Must be located in the US, Eastern time zone hours")).toBeNull();
      expect(detect("English only")).toBeNull();
      expect(detect("Remote only")).toBeNull();
    });
  });

  describe("listas con comas, pronombre 'us', ':' y rendimiento (ronda 66, vuelta 2)", () => {
    it("lista con AR terminada en 'only' no restringe, con y sin paréntesis", () => {
      expect(detect("Remote - Brazil, Argentina, Mexico only")).toBeNull();
      expect(detect("Remote (Argentina, Chile, Mexico only)")).toBeNull();
      expect(detect("Argentina, Colombia, Mexico only")).toBeNull();
    });

    it("lista sin AR terminada en 'only' restringe con todos los países", () => {
      expect(detect("Canada, US only")?.countries).toEqual(["CA", "US"]);
      expect(detect("Remote (Brazil, Chile, Mexico only)")?.countries).toEqual(["BR", "CL", "MX"]);
    });

    it("lista larga con AR después del carácter 120 no restringe", () => {
      const relleno = Array.from({ length: 20 }, () => "Canada").join(", ");
      expect(relleno.length).toBeGreaterThan(120);
      expect(detect(`Must be based in ${relleno}, Argentina`)).toBeNull();
      expect(detect(`${relleno}, Argentina only`)).toBeNull();
    });

    it("el pronombre 'us' no es EE.UU.", () => {
      expect(
        detect(
          "You must be based in a country supported by our payroll provider, contact us if unsure",
        ),
      ).toBeNull();
      expect(detect("Must be based in the US")?.countries).toEqual(["US"]);
      expect(detect("Must be based in the USA")?.countries).toEqual(["US"]);
      expect(detect("Must be based in the U.S.")?.countries).toEqual(["US"]);
    });

    it("':' corta la lista: lo que sigue no contamina", () => {
      const r = detect("Must be based in Canada: remote-first team across Argentina and Brazil");
      expect(r?.countries).toEqual(["CA"]);
    });

    it("'only' no arrastra lugares que no son la lista (vuelta 3)", () => {
      expect(detect("Our HQ is in Toronto, Canada, fully remote only")).toBeNull();
      expect(detect("We are a Canada-based company, remote only")).toBeNull();
      expect(detect("Remote (Canada only)")?.countries).toEqual(["CA"]);
      expect(detect("Argentina, the US only")).toBeNull();
      expect(detect("Canada, the US only")?.countries).toEqual(["CA", "US"]);
    });

    it("beneficios y exclusiones no son residencia", () => {
      expect(detect("Visa sponsorship available in the US only")).toBeNull();
      expect(detect("Equity for Canada only")).toBeNull();
      expect(detect("Relocation for the UK only")).toBeNull();
      expect(detect("LATAM (excluding Argentina), Mexico only")).toBeNull();
      expect(detect("Remote (LATAM excluding Argentina, Mexico only)")).toBeNull();
      expect(detect("Brazil, Argentina, Mexico only")).toBeNull();
      expect(detect("Canada, US only")?.countries).toEqual(["CA", "US"]);
      expect(detect("Remote (Canada only)")?.countries).toEqual(["CA"]);
    });

    it("1100 repeticiones de una frase explícita terminan en menos de 200 ms", () => {
      const t0 = performance.now();
      detect("must be based in ".repeat(1100));
      expect(performance.now() - t0).toBeLessThan(200);
    });

    it("texto casi todo en mayúsculas: 'US' no se interpreta como país", () => {
      expect(detect("MUST BE BASED IN A SUPPORTED COUNTRY, CONTACT US IF UNSURE")).toBeNull();
      expect(detect("CONTACT US IF UNSURE. YOU MUST BE BASED IN THE US")).toBeNull();
      expect(detect("MUST BE BASED IN CANADA")?.countries).toEqual(["CA"]);
    });

    it("20.000 caracteres de 'only, ' terminan en menos de 200 ms", () => {
      const t0 = performance.now();
      detect("only, ".repeat(3400));
      detect("canada only ".repeat(1700));
      expect(performance.now() - t0).toBeLessThan(200);
    });

    it("una JD de 30.000 caracteres con corridas de espacios y saltos termina rápido", () => {
      const trozo = `${" ".repeat(400)}\n\n${"x ".repeat(30)}${" ".repeat(300)}only${" ".repeat(200)}\n`;
      const jd = trozo.repeat(Math.ceil(30_000 / trozo.length));
      expect(jd.length).toBeGreaterThanOrEqual(30_000);
      const t0 = performance.now();
      detect(jd);
      detect(`${" ".repeat(30_000)}only`);
      expect(performance.now() - t0).toBeLessThan(200);
    });
  });

  describe("sin datos", () => {
    it("userCountry null → null, aunque el aviso restrinja", () => {
      expect(detect("Must be based in Canada", null)).toBeNull();
    });
    it("texto vacío o null → null", () => {
      expect(detect(null)).toBeNull();
      expect(detect("   ")).toBeNull();
    });
  });
});
