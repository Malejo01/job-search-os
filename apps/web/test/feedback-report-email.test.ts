import { describe, expect, it } from "vitest";
import {
  adminEmailsFrom,
  buildReportEmail,
  notifyReportAdmins,
  siteBaseUrl,
  type ReportEmail,
} from "../lib/feedback-report-email";

describe("buildReportEmail", () => {
  const email = buildReportEmail({
    summary: "12 ítems, 18 capturas, 2 documentos",
    baseUrl: "https://app.example",
  });

  it("lleva el resumen y el link a /admin/informes", () => {
    expect(email.text).toContain("12 ítems, 18 capturas, 2 documentos");
    expect(email.text).toContain("https://app.example/admin/informes");
    expect(email.html).toContain('href="https://app.example/admin/informes"');
  });

  it("sin dirección configurada dice la ruta, sin link roto", () => {
    const sin = buildReportEmail({ summary: "1 ítem, 0 capturas, 0 documentos", baseUrl: null });
    expect(sin.text).toContain("/admin/informes");
    expect(sin.html).not.toContain("href=");
  });

  it("no lleva nombre ni email de nadie, solo el resumen y el link", () => {
    const todo = `${email.subject}\n${email.text}\n${email.html.replace(/<style[\s\S]*?<\/style>/g, "")}`;
    expect(todo).not.toMatch(/@/);
    expect(email.subject).toContain("Nuevo informe");
  });

  it("escapa el resumen en el HTML", () => {
    const html = buildReportEmail({ summary: "<b>x</b>", baseUrl: null }).html;
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("notifyReportAdmins", () => {
  it("manda uno por admin con el mismo aviso", async () => {
    const sent: (ReportEmail & { to: string })[] = [];
    const out = await notifyReportAdmins({
      summary: "2 ítems, 1 captura, 0 documentos",
      baseUrl: "https://app.example",
      admins: ["a@example.com", "b@example.com"],
      send: async (m) => {
        sent.push(m);
      },
    });
    expect(out).toEqual({ sent: 2, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["a@example.com", "b@example.com"]);
    expect(new Set(sent.map((m) => m.subject)).size).toBe(1);
  });

  it("un envío que falla no frena a los demás", async () => {
    const out = await notifyReportAdmins({
      summary: "x",
      baseUrl: null,
      admins: ["a@example.com", "b@example.com", "c@example.com"],
      send: async (m) => {
        if (m.to === "b@example.com") throw new Error("falló");
      },
    });
    expect(out).toEqual({ sent: 2, failed: 1 });
  });

  it("sin admins no manda nada", async () => {
    const out = await notifyReportAdmins({
      summary: "x",
      baseUrl: null,
      admins: [],
      send: async () => {
        throw new Error("no debería llamarse");
      },
    });
    expect(out).toEqual({ sent: 0, failed: 0 });
  });
});

describe("siteBaseUrl y adminEmailsFrom", () => {
  it("toma SITE_URL, después AUTH_URL, después NEXT_PUBLIC_APP_URL, y deja solo el origen", () => {
    expect(siteBaseUrl({ SITE_URL: "https://uno.example/ruta?x=1" })).toBe("https://uno.example");
    expect(siteBaseUrl({ AUTH_URL: "https://dos.example" })).toBe("https://dos.example");
    expect(siteBaseUrl({ NEXT_PUBLIC_APP_URL: "http://localhost:3000/" })).toBe(
      "http://localhost:3000",
    );
  });

  it("una URL rara o ausente da null", () => {
    expect(siteBaseUrl({})).toBeNull();
    expect(siteBaseUrl({ SITE_URL: "no es una url" })).toBeNull();
    expect(siteBaseUrl({ SITE_URL: "javascript:alert(1)" })).toBeNull();
  });

  it("ADMIN_EMAILS se parte, se pasa a minúsculas y no se repite", () => {
    expect(
      adminEmailsFrom({ ADMIN_EMAILS: " A@Example.com, b@example.com ,a@example.com,," }),
    ).toEqual(["a@example.com", "b@example.com"]);
    expect(adminEmailsFrom({})).toEqual([]);
  });
});
