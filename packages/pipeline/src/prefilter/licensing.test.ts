import { describe, expect, it } from "vitest";
import { detectProfessionalLicense } from "./licensing";

const detect = (text: string | null, country: string | null = "AR", locationRaw?: string | null) =>
  detectProfessionalLicense(text, country, locationRaw);

describe("detectProfessionalLicense", () => {
  describe("reconoce el conjunto estricto", () => {
    it.each([
      ["You must be licensed in your state", "must be licensed"],
      ["Licensed to practice law", "licensed to practice"],
      ["Licensed attorney preferred", "licensed attorney"],
      ["Professional license required", "professional license"],
      ["Professional licensure is a plus", "professional licensure"],
      ["Active state license", "state license"],
      ["State licence needed", "state licence"],
      ["Bar admission in any US state", "bar admission"],
      ["Admitted to the bar", "admitted to the bar"],
      ["Admitted to practice in New York", "admitted to practice"],
      ["Current RN license", "rn license"],
      ["Registered nurse with 3 years", "registered nurse"],
      ["Nursing license in good standing", "nursing license"],
      ["Law license from any jurisdiction", "law license"],
      ["Medical license", "medical license"],
      ["Board certified physician", "board certified"],
      ["Certified Public Accountant", "certified public accountant"],
      ["NMLS ID required", "nmls"],
      ["Series 7 and Series 63", "series 7"],
      ["Series 65 holder", "series 65"],
      ["Series 66", "series 66"],
      ["Matrícula profesional vigente", "matricula profesional"],
      ["Matrícula habilitante", "matricula habilitante"],
      ["Abogada colegiada", "colegiada"],
      ["Contador colegiado", "colegiado"],
      ["A valid license required for this role", "license required"],
      ["Professional licence required", "professional licence"],
    ])("%s", (text, term) => {
      const r = detect(text, "MX");
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
      expect(r?.phrase.length).toBeGreaterThan(0);
    });
  });

  describe("no reconoce", () => {
    it.each([
      "Valid driver's license required",
      "A valid drivers license is required",
      "Driver’s license required",
      "Licencia de conducir: license required",
      "Candidates must be licensed to drive in the state",
      "Drivers must be licensed and insured",
      "Licensed under the MIT license",
      "This software is licensed to our customers",
      "Reduce the cost per acquisition (CPA)",
      "We are a CPA firm",
      "Apoyo para colegiaturas",
      "Series B startup",
      "Series A and Series C investors",
      "Our board of directors",
      "Matrícula escolar",
      "matrícula sola",
      "We license our software",
      "",
    ])("%s", (text) => {
      expect(detect(text)).toBeNull();
    });

    it("texto nulo o en blanco", () => {
      expect(detect(null)).toBeNull();
      expect(detect("   ")).toBeNull();
    });
  });

  describe("país de la persona", () => {
    it("con el país nombrado al lado, la licencia es del propio país", () => {
      const r = detect("Se requiere matrícula profesional en Argentina.", "AR");
      expect(r).toMatchObject({ term: "matricula profesional", ownCountry: true });
    });

    it("con el nombre en inglés también", () => {
      expect(detect("Bar admission in Brazil preferred", "BR")?.ownCountry).toBe(true);
    });

    it("'New Mexico' no es México (JS-111)", () => {
      expect(detect("Active RN license in New Mexico required", "MX")?.ownCountry).toBe(false);
      expect(detect("CPA required", "MX", "Albuquerque, New Mexico")?.ownCountry).toBe(false);
      expect(detect("Active RN license in Mexico required", "MX")?.ownCountry).toBe(true);
      // La ubicación propia no vuelve propia una licencia de New Mexico
      expect(
        detect("Active RN license in New Mexico required", "MX", "Ciudad de México")?.ownCountry,
      ).toBe(false);
    });

    it("con otro país al lado no es la propia", () => {
      expect(detect("Se requiere matrícula profesional en Chile.", "AR")?.ownCountry).toBe(false);
    });

    it("el país nombrado lejos (más de 120 caracteres) no cuenta", () => {
      const far = `${"x ".repeat(80)}Argentina`;
      expect(detect(`Bar admission required. ${far}`, "AR")?.ownCountry).toBe(false);
    });

    it("ante varias frases, si una es del propio país manda esa", () => {
      const text = `Bar admission in Chile.${" y".repeat(100)} Matrícula profesional en Argentina.`;
      expect(detect(text, "AR")).toMatchObject({ term: "matricula profesional", ownCountry: true });
    });

    it("con país desconocido nunca es la propia", () => {
      expect(detect("Matrícula profesional en Argentina", null)?.ownCountry).toBe(false);
    });
  });

  describe("contaduría (C-2b)", () => {
    it.each([
      ["Licensed CPA with 3 years of experience", "licensed cpa"],
      ["Active CPA in good standing", "active cpa"],
      ["Current CPA", "current cpa"],
      ["CPA license required", "cpa license"],
      ["CPA licensure", "cpa licensure"],
      ["CPA required", "cpa required"],
      ["CPA certification required", "cpa certification required"],
      ["You must be a CPA", "must be a cpa"],
      // «active cpa» se reconoce primero (misma frase, otro patrón)
      ["Must hold an active CPA", "active cpa"],
      ["Must hold a CPA", "must hold a cpa"],
      ["Enrolled Agent (EA) status", "enrolled agent"],
      ["Contador Público Matriculado", "contador publico matriculado"],
      ["Contadora matriculada", "contadora matriculada"],
      ["Contadores públicos matriculados", "contadores publicos matriculados"],
    ])("reconoce: %s", (text, term) => {
      const r = detect(text, "MX");
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
      expect(r?.preferred).toBe(false);
    });

    it.each([
      "Reduce the cost per acquisition (CPA)",
      "Improve CPA and ROAS on paid channels",
      "We are a CPA firm",
      "Título de Contador Público",
      "Contador Público (título universitario)",
      "Contador público con experiencia en impuestos",
    ])("no hace nada: %s", (text) => {
      expect(detect(text, "MX")).toBeNull();
    });

    it.each([
      "Licensed CPA preferred",
      "Licensed CPA is a plus",
      "CPA license a plus",
      "CPA license nice to have",
      "CPA license desirable",
      "CPA license or equivalent",
      "Active CPA or working toward CPA",
      "Contador público matriculado deseable",
      "Contador público matriculado valorable",
      "Contador público matriculado o en curso",
    ])("preferido, no excluyente: %s", (text) => {
      // «CPA» suelto no es una frase del conjunto: todas llevan una frase que sí lo es.
      const r = detect(text, "MX");
      expect(r, text).not.toBeNull();
      expect(r?.preferred, text).toBe(true);
    });

    it("«preferably» o «preferentemente» antes de la frase también la hace preferida", () => {
      expect(detect("Preferably a licensed CPA", "MX")?.preferred).toBe(true);
      expect(detect("Preferentemente contador público matriculado", "MX")?.preferred).toBe(true);
    });

    it("«required» y lo lejano no la hacen preferida", () => {
      expect(detect("CPA required", "MX")?.preferred).toBe(false);
      const far = `CPA required.${" y".repeat(40)} preferred`;
      expect(detect(far, "MX")?.preferred).toBe(false);
    });

    it("ante dos frases, la excluyente manda sobre la preferida", () => {
      const r = detect("Licensed CPA preferred. Bar admission in New York required.", "MX");
      expect(r).toMatchObject({ term: "bar admission", preferred: false });
    });

    it("S-1: la ventana de «preferred» se corta en el fin de oración o de línea", () => {
      expect(detect("CPA license required. NetSuite preferred", "MX")?.preferred).toBe(false);
      expect(detect("CPA license required; NetSuite preferred", "MX")?.preferred).toBe(false);
      expect(detect("CPA license required\nNetSuite preferred", "MX")?.preferred).toBe(false);
      expect(detect("Licensed CPA preferred.", "MX")?.preferred).toBe(true);
      expect(detect("Preferably. Licensed CPA required", "MX")?.preferred).toBe(false);
      expect(detect("Preferably a licensed CPA", "MX")?.preferred).toBe(true);
    });

    it("S-2: otro país en la ventana de la frase anula la ubicación propia", () => {
      const us = "must hold an active CPA license in the United States";
      expect(detect(us, "AR", "Argentina")?.ownCountry).toBe(false);
      expect(detect("Licensed CPA required in Chile", "AR", "Argentina")?.ownCountry).toBe(false);
      expect(detect("Licensed CPA required", "AR", "Remote, Argentina")?.ownCountry).toBe(true);
    });

    it("cpce y facpce son de Argentina", () => {
      expect(detect("Contador público matriculado en el CPCE", "AR")?.ownCountry).toBe(true);
      expect(detect("Matriculado FACPCE: contador público matriculado", "AR")?.ownCountry).toBe(
        true,
      );
      expect(detect("Contador público matriculado en el CPCE", "MX")?.ownCountry).toBe(false);
    });

    it("la ubicación del aviso que nombra el país de la persona hace propia la licencia", () => {
      expect(detect("CPA required", "AR", "Buenos Aires, Argentina")?.ownCountry).toBe(true);
      expect(detect("CPA required", "AR", "Remote")?.ownCountry).toBe(false);
      expect(detect("CPA required", "AR", "Santiago, Chile")?.ownCountry).toBe(false);
      expect(detect("CPA required", null, "Buenos Aires, Argentina")?.ownCountry).toBe(false);
    });
  });

  describe("T1: patrones nuevos", () => {
    const off = (text: string, country = "AR") => detect(text, country);

    it.each([
      ["Must be licensed in California", "licensed in california"],
      ["Licensed in the US", "licensed in the us"],
      ["Licensed in the United States", "licensed in the united states"],
      ["Licensed in any state", "licensed in any state"],
      ["Licensed in the state of Texas", "licensed in the state of"],
      ["Licensed in New York", "licensed in new york"],
      ["Licensed in Canada", "licensed in canada"],
      ["Licensed in the UK", "licensed in the uk"],
      ["Licensed in Reino Unido", "licensed in reino unido"],
      ["Licensed in Spain", "licensed in spain"],
      ["Licensed in Mexico", "licensed in mexico"],
      ["Licensed in Brazil", "licensed in brazil"],
      ["Licensed in Colombia", "licensed in colombia"],
      ["Licensed in Chile", "licensed in chile"],
      ["Licensed in Peru", "licensed in peru"],
    ])("licensed in <lugar>: %s", (text, term) => {
      const r = off(text);
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
    });

    it("licensed in <lugar>: cubre los 50 estados", () => {
      const states = [
        "Alabama",
        "Alaska",
        "Arizona",
        "Arkansas",
        "California",
        "Colorado",
        "Connecticut",
        "Delaware",
        "Florida",
        "Georgia",
        "Hawaii",
        "Idaho",
        "Illinois",
        "Indiana",
        "Iowa",
        "Kansas",
        "Kentucky",
        "Louisiana",
        "Maine",
        "Maryland",
        "Massachusetts",
        "Michigan",
        "Minnesota",
        "Mississippi",
        "Missouri",
        "Montana",
        "Nebraska",
        "Nevada",
        "New Hampshire",
        "New Jersey",
        "New Mexico",
        "New York",
        "North Carolina",
        "North Dakota",
        "Ohio",
        "Oklahoma",
        "Oregon",
        "Pennsylvania",
        "Rhode Island",
        "South Carolina",
        "South Dakota",
        "Tennessee",
        "Texas",
        "Utah",
        "Vermont",
        "Virginia",
        "Washington",
        "West Virginia",
        "Wisconsin",
        "Wyoming",
      ];
      expect(states).toHaveLength(50);
      for (const s of states)
        expect(off(`Licensed in ${s}`)?.term, s).toBe(`licensed in ${s.toLowerCase()}`);
    });

    it("licensed in <país>: el país de la persona la vuelve propia", () => {
      expect(detect("Licensed in Argentina", "AR")).toMatchObject({
        term: "licensed in argentina",
        ownCountry: true,
      });
      expect(detect("Licensed in Argentina", "MX")?.ownCountry).toBe(false);
    });

    it.each([
      "Licensed in the EU under MIT",
      "Licensed in Spain under the Apache license",
      "This software is licensed in Canada under GPL",
      "Open source code licensed in the US",
      "BSD, licensed in California",
      "Licensed in Texas for the driver program",
      "Licensed under Apache",
      "Licensed in the EU",
      "Licensed in Narnia",
    ])("licensed in: no hace nada: %s", (text) => {
      expect(off(text)).toBeNull();
    });

    it.each([
      ["Must hold a valid license to practice", "must hold a valid license"],
      ["You must have an active nursing licence", "nursing licence"], // gana el patrón histórico, misma frase
      ["Must possess a current state bar license", "must possess a current state bar license"],
      ["Must maintain a license in good standing", "must maintain a license"],
      ["Must obtain a real estate license", "must obtain a real estate license"],
    ])("must hold … license: %s", (text, term) => {
      const r = off(text);
      expect(r).not.toBeNull();
      expect(r?.ownCountry).toBe(false);
      expect(r?.term).toBe(term);
    });

    it.each([
      "Must hold a valid driver's license",
      "Must have a driving license",
      "Must have a valid software license",
      "Must obtain an API license",
      "Must have a license key",
      "Must hold a valid license key for the tool",
      "Must have a licencia de conducir",
      "Must possess a valid conducir license",
    ])("must hold … license: no hace nada: %s", (text) => {
      expect(off(text)).toBeNull();
    });

    it.each([
      ["Licensed physician", "licensed physician"],
      ["Licensed therapist", "licensed therapist"],
      ["Licensed pharmacist", "licensed pharmacist"],
      ["Licensed electrician", "licensed electrician"],
      ["Licensed engineer", "licensed engineer"],
      ["Licensed architect", "licensed architect"],
      ["Licensed real estate agent", "licensed real estate"],
      ["Licensed insurance producer", "licensed insurance"],
      ["Licensed social worker", "licensed social worker"],
      ["Licensed counselor", "licensed counselor"],
      ["Licensed lawyer", "licensed lawyer"],
    ])("licensed <profesión>: %s", (text, term) => {
      // T1-S-2: sin verbo de requisito cerca no descarta, así que se lo agrega.
      const r = off(`Required: ${text}`);
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
    });

    it.each([
      "Licensed engineering software",
      "The product is licensed to engineers",
      "We hire engineers",
      "Licensed practical sales",
    ])("licensed <profesión>: no hace nada: %s", (text) => {
      expect(off(text)).toBeNull();
    });

    it.each([
      "Our network of licensed physicians",
      "We are licensed in Texas and all states",
      "The company is licensed in California",
      "Our team of licensed engineers",
      "Partners are licensed in Florida",
      "Licensed physicians are on our platform",
      "A licensed lawyer works here",
    ])("T1-S-2: sujeto o falta de requisito, no hace nada: %s", (text) => {
      expect(off(text), text).toBeNull();
    });

    it("T1-S-2: «Must be a licensed physician in Texas» descarta", () => {
      expect(off("Must be a licensed physician in Texas")).toMatchObject({
        term: "licensed physician",
        ownCountry: false,
      });
      expect(off("Requisito: licensed lawyer")?.term).toBe("licensed lawyer");
    });

    it.each([
      "Must have a valid license and reliable vehicle",
      "Must hold a valid license to drive",
      "Must have a valid license and own car",
      "Must have a valid license and transportation",
      "Must have a valid license, licencia de conducir",
    ])("T1-S-3: conducir o vehículo, no hace nada: %s", (text) => {
      expect(off(text), text).toBeNull();
    });

    it("T1-S-3: el vehículo en otra oración no excluye", () => {
      expect(off("Must hold a valid license to practice. Own car preferred.")).not.toBeNull();
    });

    it("T1-S-1: React Native (RN) no es enfermería", () => {
      expect(off("React Native (RN) required")).toBeNull();
      expect(off("React Native (RN) license for the store")).toBeNull();
      expect(off("RN required")).toBeNull();
      expect(off("RN license required")).toMatchObject({ ownCountry: false });
      expect(off("Experienced RN, active licensed")).not.toBeNull();
    });

    it("T1-S-4: el tope de 50 cuenta coincidencias que pasaron los filtros", () => {
      const text = `${"LPN ".repeat(60)}LPN license`;
      expect(off(text)?.term).toBe("lpn");
    });

    it("«licensed attorney» sigue existiendo", () => {
      expect(off("Licensed attorney")?.term).toBe("licensed attorney");
    });

    it.each([
      ["PE license required", "pe license"],
      ["Must hold a P.E. license", "p.e. license"],
      ["Able to apply a P.E. stamp", "p.e. stamp"],
      ["Professional Engineer, licensed", "professional engineer"],
      ["Registered Professional Engineer", "professional engineer"],
    ])("PE: %s", (text, term) => {
      const r = off(text);
      expect(r, text).not.toBeNull();
      expect(r?.ownCountry).toBe(false);
      if (term !== "professional engineer") expect(r?.term, text).toBe(term);
    });

    it.each([
      "Professional engineering services",
      "We are a professional engineer team",
      "Professional engineer who loves Rust, remote team of 30 people worldwide, and a stamp collection nowhere near",
      "Apple license for ape store",
    ])("PE: no hace nada: %s", (text) => {
      expect(off(text)).toBeNull();
    });

    it.each([
      ["RN license required", "rn"],
      ["Active RN, licensed in good standing", "rn"],
      ["LPN license", "lpn"],
      ["NCLEX required", "nclex"],
      ["Passed the NCLEX, licensed", "nclex"],
      ["Required: LPN", "lpn"],
    ])("RN, LPN y NCLEX con contexto: %s", (text, term) => {
      const r = off(text);
      expect(r, text).not.toBeNull();
      expect(r?.term, text).toContain(term);
      expect(r?.ownCountry).toBe(false);
    });

    it.each([
      "A modern stack with a license for the cloud",
      "Our RN team is great",
      "We use RN for apps",
      "Experience with LPN",
      "NCLEX",
      "rn and lpn and nclex required",
      "Modern apps required",
      "Modern license-free stack",
    ])("RN, LPN y NCLEX: no hace nada: %s", (text) => {
      expect(off(text), text).toBeNull();
    });

    it("«modern» con licencia cerca no dispara «rn»", () => {
      expect(off("Modern license required")?.term).toBe("license required");
    });

    it.each([
      ["Must pass the bar exam", "bar exam"],
      ["Member of the Bar", "member of the bar"],
      ["Juris Doctor degree", "juris doctor"],
    ])("derecho: %s", (text, term) => {
      const r = off(text);
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
    });

    it.each([
      "Sprint bar for the team",
      "A bar chart of sales",
      "JD and CV required",
      "Read the JD carefully",
      "Salad bar in the office",
    ])("derecho: no hace nada: %s", (text) => {
      expect(off(text)).toBeNull();
    });

    it.each([
      ["Abogado con matrícula vigente", "matricula vigente"],
      ["Contador con tarjeta profesional", "tarjeta profesional"],
      ["Enfermero con cédula profesional", "cedula profesional"],
      ["Ingeniera matriculada", "matriculada"],
      ["Arquitecto matriculado", "matriculado"],
      ["Psicólogo, matriculado", "matriculado"],
      ["Médicos matriculados", "matriculados"],
    ])("español con profesión: %s", (text, term) => {
      const r = detect(text, "MX");
      expect(r?.term).toBe(term);
      expect(r?.ownCountry).toBe(false);
    });

    it.each([
      "Matrícula del curso",
      "Matrícula de inscripción",
      "Pago de matrícula vigente del colegio",
      "Estudiante matriculado en la universidad",
      "Tarjeta profesional de presentación",
      "Cédula profesional",
      "Contador con experiencia: la matrícula del curso es gratis",
    ])("español: no hace nada: %s", (text) => {
      expect(detect(text, "MX")).toBeNull();
    });

    it("español: la profesión lejos (más de 60 caracteres) no cuenta", () => {
      expect(detect(`Abogado.${" y".repeat(50)} matriculado`, "MX")).toBeNull();
    });

    it("español: con el país de la persona al lado, es propia", () => {
      expect(detect("Abogado matriculado en Argentina", "AR")?.ownCountry).toBe(true);
    });

    it("«matrícula habilitante en <otro país>» descarta (término y país ajeno)", () => {
      const r = detect("Se requiere matrícula habilitante en Chile", "AR");
      expect(r).toMatchObject({
        term: "matricula habilitante",
        ownCountry: false,
        preferred: false,
      });
    });

    it("«preferred» sigue marcando el flag con los patrones nuevos", () => {
      expect(off("Licensed in California preferred")?.preferred).toBe(true);
      expect(off("Bar exam required")?.preferred).toBe(false);
    });

    it("tolera texto adversarial en los patrones nuevos", () => {
      const evil = `must hold a ${"valid ".repeat(5000)} licensed in ${"x ".repeat(5000)}`;
      expect(() => off(evil)).not.toThrow();
      const many = "bar exam. ".repeat(1000);
      expect(off(many)?.term).toBe("bar exam");
    });
  });

  it("es determinista y tolera texto largo", () => {
    const long = `${"palabra ".repeat(10_000)} bar admission`;
    expect(detect(long)).toBeNull();
    expect(detect("Bar admission")).toEqual(detect("Bar admission"));
  });
});
