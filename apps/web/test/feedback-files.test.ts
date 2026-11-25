import { ATTACHMENT_UPLOADS_PER_DAY, ATTACHMENT_UPLOADS_PER_MINUTE } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  decideUploadRate,
  downloadHeaders,
  errorResponse,
  parseUploadForm,
} from "../lib/feedback-files";

const ITEM = "33333333-3333-4333-8333-333333333333";

async function multipart(parts: Record<string, string | File | (string | File)[]>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(parts)) {
    for (const one of Array.isArray(v) ? v : [v]) form.append(k, one);
  }
  const res = new Response(form);
  return {
    body: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type")!,
  };
}

describe("parseUploadForm", () => {
  it("lee itemId y un solo archivo", async () => {
    const { body, contentType } = await multipart({
      itemId: ITEM.toUpperCase(),
      file: new File([Uint8Array.of(1, 2, 3)], "../../a.png", { type: "image/png" }),
    });
    const r = await parseUploadForm(body, contentType);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itemId).toBe(ITEM);
    expect(r.bytes).toEqual(Uint8Array.of(1, 2, 3));
  });

  it.each([
    ["sin archivo", { itemId: ITEM }],
    ["sin itemId", { file: new File([Uint8Array.of(1)], "a.webp") }],
    [
      "itemId que no es UUID",
      { itemId: "1; drop table", file: new File([Uint8Array.of(1)], "a.webp") },
    ],
    ["itemId repetido", { itemId: [ITEM, ITEM], file: new File([Uint8Array.of(1)], "a.webp") }],
    [
      "dos archivos",
      {
        itemId: ITEM,
        file: [new File([Uint8Array.of(1)], "a.webp"), new File([Uint8Array.of(2)], "b.webp")],
      },
    ],
    [
      "un archivo extra con otro nombre",
      {
        itemId: ITEM,
        file: new File([Uint8Array.of(1)], "a.webp"),
        otro: new File([Uint8Array.of(2)], "b"),
      },
    ],
    ["file como texto", { itemId: ITEM, file: "no soy un archivo" }],
  ])("rechaza %s", async (_name, parts) => {
    const { body, contentType } = await multipart(parts as never);
    expect(await parseUploadForm(body, contentType)).toEqual({ ok: false, error: "bad_request" });
  });

  it("rechaza otro content-type y cuerpos rotos", async () => {
    expect(await parseUploadForm(new Uint8Array(4), "application/json")).toEqual({
      ok: false,
      error: "bad_request",
    });
    expect(await parseUploadForm(new Uint8Array(4), "multipart/form-data; boundary=x")).toEqual({
      ok: false,
      error: "bad_request",
    });
  });
});

describe("decideUploadRate", () => {
  it("deja pasar por debajo de los topes y frena en ellos", () => {
    expect(decideUploadRate({ lastMinute: 0, lastDay: 0 })).toBe("ok");
    expect(decideUploadRate({ lastMinute: ATTACHMENT_UPLOADS_PER_MINUTE - 1, lastDay: 5 })).toBe(
      "ok",
    );
    expect(decideUploadRate({ lastMinute: ATTACHMENT_UPLOADS_PER_MINUTE, lastDay: 5 })).toBe(
      "rate_limited",
    );
    expect(decideUploadRate({ lastMinute: 1, lastDay: ATTACHMENT_UPLOADS_PER_DAY })).toBe(
      "rate_limited",
    );
  });
  it("un número inválido frena", () => {
    expect(decideUploadRate({ lastMinute: Number.NaN, lastDay: 0 })).toBe("rate_limited");
    expect(decideUploadRate({ lastMinute: 0, lastDay: -1 })).toBe("rate_limited");
  });
});

describe("cabeceras de la descarga", () => {
  it("PDF y DOCX van como attachment; solo la imagen reescrita va inline", () => {
    expect(contentDisposition("pdf", "informe.pdf")).toMatch(/^attachment;/);
    expect(contentDisposition("docx", "tesis.docx")).toMatch(/^attachment;/);
    expect(contentDisposition("image", "captura.webp")).toMatch(/^inline;/);
  });
  it("el nombre no puede romper la cabecera (comillas, saltos, barras, UTF-8)", () => {
    const d = contentDisposition("pdf", 'a"; filename=evil.html\r\nX-Injected: 1/\\ñ.pdf');
    expect(d).not.toMatch(/[\r\n]/);
    expect(d.match(/filename="/g)).toHaveLength(1);
    expect(d).not.toContain('evil.html"');
    expect(d).toContain("filename*=UTF-8''");
    expect(contentDisposition("pdf", "año.pdf")).toContain("a%C3%B1o.pdf");
  });
  it("lleva nosniff, sandbox, sin caché y el tipo de la base", () => {
    const h = downloadHeaders({ kind: "pdf", mime: "application/pdf", name: "a.pdf", size: 12 });
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBe("sandbox");
    expect(h["Cache-Control"]).toBe("private, no-store");
    expect(h["Content-Type"]).toBe("application/pdf");
    expect(h["Content-Length"]).toBe("12");
    expect(JSON.stringify(h)).not.toContain("pgb:");
  });
});

describe("errorResponse", () => {
  it("devuelve { ok:false, error, message } con el estado del código y sin caché", async () => {
    const res = errorResponse("rate_limited");
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "rate_limited" });
    expect(String(body.message).length).toBeGreaterThan(5);
  });
  it("«no es tuyo» y «no existe» responden igual", async () => {
    const a = errorResponse("not_found");
    const b = errorResponse("forbidden");
    expect(a.status).toBe(b.status);
  });
});
