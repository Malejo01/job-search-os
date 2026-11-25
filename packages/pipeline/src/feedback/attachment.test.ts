import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ERROR_TEXTS,
  ATTACHMENT_PURGE_DAYS,
  attachmentsPurgeEnabled,
  isPurgeable,
  purgedNote,
  FEEDBACK_FILES_GLOBAL_MAX_BYTES,
  FEEDBACK_UPLOAD_REQUEST_MAX_BYTES,
  IMAGE_STORED_MAX_BYTES,
  ITEM_ATTACHMENTS_MAX,
  PERSON_FILES_MAX_BYTES,
  feedbackFilesGlobalMaxBytes,
  sanitizeFileName,
  sanitizeWebp,
  sniffAttachment,
  validateAttachmentUpload,
} from "./attachment";

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u16 = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
const u32 = (n: number) =>
  Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);

// ---------- WebP generado en el test ----------
function chunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0);
  return concat(enc(fourcc), u32(data.length), data, pad);
}
function riff(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(enc("WEBP"), ...chunks);
  return concat(enc("RIFF"), u32(body.length), body);
}
function vp8lData(w: number, h: number): Uint8Array {
  const v = (w - 1) | ((h - 1) << 14);
  return concat(Uint8Array.of(0x2f), u32(v), new Uint8Array(8));
}
function vp8Data(w: number, h: number): Uint8Array {
  return concat(
    Uint8Array.of(0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a),
    u16(w),
    u16(h),
    new Uint8Array(8),
  );
}
function vp8xData(flags: number, w: number, h: number): Uint8Array {
  const d24 = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff);
  return concat(Uint8Array.of(flags, 0, 0, 0), d24(w - 1), d24(h - 1));
}
const webpLossless = (w = 40, h = 30) => riff(chunk("VP8L", vp8lData(w, h)));
const webpWithMeta = (w = 40, h = 30) =>
  riff(
    chunk("VP8X", vp8xData(0x20 | 0x08 | 0x04, w, h)),
    chunk("ICCP", enc("perfil-de-color-oculto")),
    chunk("VP8 ", vp8Data(w, h)),
    chunk("EXIF", enc("GPS:-34.6,-58.4 camara-de-la-persona")),
    chunk("XMP ", enc("<x:xmpmeta>datos ocultos</x:xmpmeta>")),
  );

const PNG = concat(
  Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  new Uint8Array(40),
);
const JPEG = concat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), new Uint8Array(40));

// ---------- ZIP / DOCX generado en el test ----------
interface ZipEntry {
  name: string;
  data?: Uint8Array;
  declaredUncompressed?: number;
  flags?: number;
  method?: number;
}
function buildZip(
  entries: ZipEntry[],
  opts: { prefix?: Uint8Array; suffix?: Uint8Array; commentLen?: number } = {},
): Uint8Array {
  const prefix = opts.prefix ?? new Uint8Array(0);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = prefix.length;
  for (const e of entries) {
    const data = e.data ?? enc("<x/>");
    const name = enc(e.name);
    const flags = e.flags ?? 0;
    const method = e.method ?? 0;
    const uncompressed = e.declaredUncompressed ?? data.length;
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(data.length),
      u32(uncompressed),
      u16(name.length),
      u16(0),
      name,
      data,
    );
    centrals.push(
      concat(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(data.length),
        u32(uncompressed),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ),
    );
    locals.push(local);
    offset += local.length;
  }
  const cd = concat(...centrals);
  const comment = new Uint8Array(opts.commentLen ?? 0);
  const eocd = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(offset),
    u16(comment.length),
    comment,
  );
  return concat(prefix, ...locals, cd, eocd, opts.suffix ?? new Uint8Array(0));
}
const DOCX_BASE: ZipEntry[] = [
  { name: "[Content_Types].xml" },
  { name: "word/document.xml" },
  { name: "_rels/.rels" },
];
const docx = (extra: ZipEntry[] = [], opts = {}) => buildZip([...DOCX_BASE, ...extra], opts);

// ---------- PDF ----------
const pdf = (body = "") =>
  enc(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${body} >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
  );

const base = { itemCount: 0, personBytes: 0, globalBytes: 0 };
const check = (bytes: Uint8Array, name = "captura.webp", extra: Partial<typeof base> = {}) =>
  validateAttachmentUpload({ bytes, name, ...base, ...extra });

describe("sniffAttachment", () => {
  it("reconoce cada formato por los bytes", () => {
    expect(sniffAttachment(PNG)).toBe("png");
    expect(sniffAttachment(JPEG)).toBe("jpeg");
    expect(sniffAttachment(webpLossless())).toBe("webp");
    expect(sniffAttachment(pdf())).toBe("pdf");
    expect(sniffAttachment(docx())).toBe("zip");
  });
  it("rechaza SVG, HTML, GIF, vacío y texto", () => {
    expect(sniffAttachment(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffAttachment(enc("<html><script>1</script></html>"))).toBeNull();
    expect(sniffAttachment(enc("GIF89a....."))).toBeNull();
    expect(sniffAttachment(new Uint8Array(0))).toBeNull();
    expect(sniffAttachment(enc("hola"))).toBeNull();
    expect(sniffAttachment(enc("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
  });
});

describe("sanitizeWebp", () => {
  it("deja solo los chunks de imagen y apaga ICC, EXIF y XMP", () => {
    const r = sanitizeWebp(webpWithMeta(40, 30));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.width).toBe(40);
    expect(r.height).toBe(30);
    const text = new TextDecoder("latin1").decode(r.bytes);
    for (const bad of ["EXIF", "XMP ", "ICCP", "GPS", "oculto", "camara"]) {
      expect(text).not.toContain(bad);
    }
    expect(text).toContain("VP8X");
    expect(text).toContain("VP8 ");
    // flags del VP8X: sin ICC (0x20), EXIF (0x08) ni XMP (0x04)
    const at = text.indexOf("VP8X") + 8;
    expect(r.bytes[at]! & (0x20 | 0x08 | 0x04)).toBe(0);
    // el tamaño del RIFF es coherente
    const size = r.bytes[4]! | (r.bytes[5]! << 8) | (r.bytes[6]! << 16) | (r.bytes[7]! << 24);
    expect(size + 8).toBe(r.bytes.length);
    // y lo reescrito se puede volver a sanear igual (idempotente)
    const again = sanitizeWebp(r.bytes);
    expect(again.ok && again.bytes).toEqual(r.bytes);
  });
  it("descarta los bytes que sobran después del RIFF", () => {
    const r = sanitizeWebp(concat(webpLossless(), enc("<script>alert(1)</script>")));
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextDecoder("latin1").decode(r.bytes)).not.toContain("script");
  });
  it("valida ancho y alto de 1 a 4.000", () => {
    expect(sanitizeWebp(webpLossless(4000, 4000)).ok).toBe(true);
    expect(sanitizeWebp(webpLossless(4001, 10))).toEqual({ ok: false, reason: "corrupt" });
    expect(sanitizeWebp(riff(chunk("VP8 ", vp8Data(0, 10))))).toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(sanitizeWebp(riff(chunk("VP8 ", vp8Data(10, 5000))))).toEqual({
      ok: false,
      reason: "corrupt",
    });
  });
  it("rechaza animados, chunks que se pasan del archivo y estructuras raras", () => {
    const animated = riff(chunk("VP8X", vp8xData(0x02, 10, 10)), chunk("VP8 ", vp8Data(10, 10)));
    expect(sanitizeWebp(animated).ok).toBe(false);
    const truncated = webpLossless().slice(0, 30);
    expect(sanitizeWebp(truncated).ok).toBe(false);
    const liar = concat(
      enc("RIFF"),
      u32(4 + 8 + 5),
      enc("WEBP"),
      enc("VP8L"),
      u32(99999),
      new Uint8Array(5),
    );
    expect(sanitizeWebp(liar).ok).toBe(false);
    expect(sanitizeWebp(riff()).ok).toBe(false);
    expect(sanitizeWebp(riff(chunk("EXIF", enc("solo metadatos")))).ok).toBe(false);
    expect(
      sanitizeWebp(riff(chunk("VP8L", vp8lData(5, 5)), chunk("VP8L", vp8lData(5, 5)))).ok,
    ).toBe(false);
    // VP8X con otro tamaño que la imagen
    expect(
      sanitizeWebp(riff(chunk("VP8X", vp8xData(0, 99, 99)), chunk("VP8 ", vp8Data(10, 10)))).ok,
    ).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("saca rutas, traversal, control y bidi", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
    expect(sanitizeFileName("/abs/olute.pdf")).toBe("olute.pdf");
    expect(sanitizeFileName("a\u0000b\u0007c.pdf")).toBe("abc.pdf");
    expect(sanitizeFileName("factura\u202egpj.exe")).toBe("facturagpj.exe");
    expect(sanitizeFileName("..")).toBe("adjunto");
    expect(sanitizeFileName("   ")).toBe("adjunto");
    expect(sanitizeFileName("a..b...c.pdf")).not.toContain("..");
    expect(sanitizeFileName('a<b>:"c|?*.pdf')).toBe("a_b___c___.pdf");
  });
  it("fuerza la extensión del tipo detectado y acota el largo", () => {
    expect(sanitizeFileName("foto.png", "webp")).toBe("foto.webp");
    expect(sanitizeFileName("informe.exe", "pdf")).toBe("informe.pdf");
    expect(sanitizeFileName("sin-extension", "docx")).toBe("sin-extension.docx");
    const long = sanitizeFileName(`${"a".repeat(500)}.png`, "webp");
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".webp")).toBe(true);
  });
  it("evita nombres reservados de Windows", () => {
    expect(sanitizeFileName("CON.pdf", "pdf")).toBe("_CON.pdf");
    expect(sanitizeFileName("nul", "pdf")).toBe("_nul.pdf");
  });
});

describe("validateAttachmentUpload · imágenes", () => {
  it("acepta un WebP y lo guarda reescrito", () => {
    const r = check(webpWithMeta());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("image");
    expect(r.mime).toBe("image/webp");
    expect(r.width).toBe(40);
    expect(r.height).toBe(30);
    expect(r.name).toBe("captura.webp");
    expect(new TextDecoder("latin1").decode(r.bytes)).not.toContain("EXIF");
  });
  it("un PNG o JPEG directo se rechaza para que se vuelva a elegir", () => {
    expect(check(PNG, "a.png")).toEqual({ ok: false, reason: "image_reencode" });
    expect(check(JPEG, "a.jpg")).toEqual({ ok: false, reason: "image_reencode" });
  });
  it("un SVG o HTML con extensión .png se rechaza por tipo", () => {
    expect(check(enc("<svg onload=alert(1)></svg>"), "x.png")).toEqual({
      ok: false,
      reason: "type",
    });
    expect(check(enc("<html><script>1</script>"), "x.png")).toEqual({ ok: false, reason: "type" });
    expect(check(enc("GIF89a"), "x.png")).toEqual({ ok: false, reason: "type" });
  });
  it("HTML con cabecera de PNG no pasa (PNG directo)", () => {
    const poly = concat(PNG.slice(0, 8), enc("<script>alert(1)</script>"));
    expect(check(poly, "x.png").ok).toBe(false);
  });
  it("un WebP de más de 1,5 MB ya reescrito se rechaza", () => {
    const big = riff(
      chunk("VP8L", concat(vp8lData(100, 100), new Uint8Array(IMAGE_STORED_MAX_BYTES))),
    );
    expect(check(big)).toEqual({ ok: false, reason: "too_large" });
  });
  it("un archivo vacío se rechaza", () => {
    expect(check(new Uint8Array(0))).toEqual({ ok: false, reason: "empty" });
  });
});

describe("validateAttachmentUpload · PDF", () => {
  it("acepta un PDF limpio y lo deja intacto", () => {
    const bytes = pdf();
    const r = check(bytes, "../../informe.exe");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("pdf");
    expect(r.mime).toBe("application/pdf");
    expect(r.name).toBe("informe.pdf");
    expect(r.bytes).toEqual(bytes);
    expect(r.width).toBeNull();
  });
  it.each([
    "/JavaScript",
    "/JS (app.alert(1))",
    "/Launch",
    "/EmbeddedFile",
    "/EmbeddedFiles",
    "/OpenAction 5 0 R",
    "/AA << >>",
    "/RichMedia",
    "/XFA",
    "/Encrypt 9 0 R",
    "/J#61vaScript",
    "/#4aS",
  ])("rechaza un PDF con %s", (token) => {
    expect(check(pdf(token), "a.pdf")).toEqual({ ok: false, reason: "unsafe_pdf" });
  });
  it("un nombre parecido pero distinto no se confunde (/JSON, /AAA)", () => {
    expect(check(pdf("/JSON 1 /AAA 2"), "a.pdf").ok).toBe(true);
  });
  it("rechaza un polyglot PDF + ZIP", () => {
    const zip = docx();
    const poly = concat(enc("%PDF-1.4\n"), zip);
    expect(check(poly, "a.pdf")).toEqual({ ok: false, reason: "unsafe_pdf" });
  });
});

describe("validateAttachmentUpload · DOCX", () => {
  it("acepta un DOCX mínimo", () => {
    const r = check(docx(), "tesis.docx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("docx");
    expect(r.mime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
  it("sin [Content_Types].xml o sin word/document.xml no es un DOCX", () => {
    expect(check(buildZip([{ name: "word/document.xml" }]), "a.docx")).toEqual({
      ok: false,
      reason: "unsafe_docx",
    });
    expect(check(buildZip([{ name: "[Content_Types].xml" }]), "a.docx")).toEqual({
      ok: false,
      reason: "unsafe_docx",
    });
    expect(check(buildZip([{ name: "foto.txt" }]), "a.docx")).toEqual({
      ok: false,
      reason: "unsafe_docx",
    });
  });
  it.each([
    "word/vbaProject.bin",
    "word/embeddings/oleObject1.bin",
    "word/embeddings/algo.xlsx",
    "word/activeX/activeX1.bin",
    "word/otro.bin",
    "../fuera.xml",
    "word/../../fuera.xml",
    "/abs/fuera.xml",
    "word\\fuera.xml",
    "C:/windows/x.xml",
    "word/\u0000.xml",
  ])("rechaza un DOCX con la entrada %s", (name) => {
    expect(check(docx([{ name }]), "a.docx")).toEqual({ ok: false, reason: "unsafe_docx" });
  });
  it("rechaza entradas cifradas y métodos de compresión raros", () => {
    expect(check(docx([{ name: "word/x.xml", flags: 1 }]), "a.docx").ok).toBe(false);
    expect(check(docx([{ name: "word/x.xml", method: 99 }]), "a.docx").ok).toBe(false);
  });
  it("rechaza más de 2.000 entradas", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({
      name: `word/e${i}.xml`,
      data: enc("x"),
    }));
    expect(check(docx(many), "a.docx")).toEqual({ ok: false, reason: "unsafe_docx" });
  });
  it("rechaza una zip bomb: tamaño descomprimido declarado enorme o razón absurda", () => {
    const bomb = docx([
      { name: "word/bomba.xml", data: new Uint8Array(100), declaredUncompressed: 60 * 1024 * 1024 },
    ]);
    expect(check(bomb, "a.docx")).toEqual({ ok: false, reason: "unsafe_docx" });
    const ratio = docx([
      {
        name: "word/densa.xml",
        data: new Uint8Array(100),
        declaredUncompressed: 20 * 1024 * 1024,
        method: 8,
      },
    ]);
    expect(check(ratio, "a.docx")).toEqual({ ok: false, reason: "unsafe_docx" });
  });
  it("rechaza datos antes o después del ZIP (polyglots) y comentarios que no cierran", () => {
    expect(check(docx([], { prefix: enc("<html>") }), "a.docx").ok).toBe(false);
    expect(check(docx([], { suffix: enc("<script>x</script>") }), "a.docx").ok).toBe(false);
  });
  it("rechaza ZIP truncado o sin directorio central", () => {
    const z = docx();
    expect(check(z.slice(0, z.length - 10), "a.docx").ok).toBe(false);
    expect(check(concat(enc("PK\x03\x04"), new Uint8Array(100)), "a.docx").ok).toBe(false);
  });
  it("rechaza entradas que se superponen (bomba cuasi-quine)", () => {
    const z = docx();
    // pisa el offset local de la 2.ª entrada para que apunte a la 1.ª
    const view = new DataView(z.buffer, z.byteOffset, z.byteLength);
    let eocd = z.length - 22;
    while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
    let p = view.getUint32(eocd + 16, true);
    const nameLen = view.getUint16(p + 28, true);
    p += 46 + nameLen; // 2.ª entrada
    view.setUint32(p + 42, 0, true);
    expect(check(z, "a.docx").ok).toBe(false);
  });
});

describe("validateAttachmentUpload · topes", () => {
  it("más de 4 MB por pedido", () => {
    const big = concat(pdf(), new Uint8Array(FEEDBACK_UPLOAD_REQUEST_MAX_BYTES));
    expect(check(big, "a.pdf")).toEqual({ ok: false, reason: "request_too_large" });
  });
  it("10 adjuntos por ítem", () => {
    expect(check(webpLossless(), "a.webp", { itemCount: ITEM_ATTACHMENTS_MAX - 1 }).ok).toBe(true);
    expect(check(webpLossless(), "a.webp", { itemCount: ITEM_ATTACHMENTS_MAX })).toEqual({
      ok: false,
      reason: "item_full",
    });
  });
  it("100 MB por persona y 400 MB globales", () => {
    const w = webpLossless();
    expect(check(w, "a.webp", { personBytes: PERSON_FILES_MAX_BYTES })).toEqual({
      ok: false,
      reason: "person_quota",
    });
    expect(check(w, "a.webp", { personBytes: PERSON_FILES_MAX_BYTES - w.length - 100 }).ok).toBe(
      true,
    );
    expect(check(w, "a.webp", { globalBytes: FEEDBACK_FILES_GLOBAL_MAX_BYTES })).toEqual({
      ok: false,
      reason: "global_quota",
    });
  });
  it("entradas numéricas inválidas fallan cerrado", () => {
    expect(check(webpLossless(), "a.webp", { personBytes: Number.NaN }).ok).toBe(false);
    expect(check(webpLossless(), "a.webp", { itemCount: -1 }).ok).toBe(false);
    expect(check(webpLossless(), "a.webp", { globalBytes: Number.POSITIVE_INFINITY }).ok).toBe(
      false,
    );
  });
  it("cada código tiene su texto en llano", () => {
    for (const reason of [
      "empty",
      "type",
      "image_reencode",
      "unsafe_pdf",
      "unsafe_docx",
      "corrupt",
      "too_large",
      "request_too_large",
      "item_full",
      "person_quota",
      "global_quota",
      "rate_limited",
      "no_session",
      "forbidden",
      "not_found",
      "report_locked",
    ] as const) {
      expect(ATTACHMENT_ERROR_TEXTS[reason].length).toBeGreaterThan(5);
    }
  });
});

describe("limpieza de adjuntos de lo resuelto (R29-09)", () => {
  const now = new Date("2026-12-31T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const base = { itemStatus: "resuelto", reportStatus: "enviado", alreadyDeleted: false } as const;

  it("la regla de los 30 días: solo resuelto y con 30 días o más desde el cambio de estado", () => {
    expect(ATTACHMENT_PURGE_DAYS).toBe(30);
    expect(isPurgeable({ ...base, statusChangedAt: days(30) }, now)).toBe(true);
    expect(isPurgeable({ ...base, statusChangedAt: days(90) }, now)).toBe(true);
    expect(isPurgeable({ ...base, statusChangedAt: days(29) }, now)).toBe(false);
    expect(isPurgeable({ ...base, statusChangedAt: days(0) }, now)).toBe(false);
  });
  it("nunca lo nuevo, lo visto, un borrador, lo ya borrado o sin fecha de cambio", () => {
    const old = days(100);
    expect(isPurgeable({ ...base, itemStatus: "nuevo", statusChangedAt: old }, now)).toBe(false);
    expect(isPurgeable({ ...base, itemStatus: "visto", statusChangedAt: old }, now)).toBe(false);
    expect(isPurgeable({ ...base, reportStatus: "borrador", statusChangedAt: old }, now)).toBe(
      false,
    );
    expect(isPurgeable({ ...base, alreadyDeleted: true, statusChangedAt: old }, now)).toBe(false);
    expect(isPurgeable({ ...base, statusChangedAt: null }, now)).toBe(false);
    expect(isPurgeable({ ...base, statusChangedAt: new Date("nada") }, now)).toBe(false);
  });
  it("con otro número de días y un valor inválido (falla cerrado)", () => {
    expect(isPurgeable({ ...base, statusChangedAt: days(10) }, now, 7)).toBe(true);
    expect(isPurgeable({ ...base, statusChangedAt: days(100) }, now, 0)).toBe(false);
    expect(isPurgeable({ ...base, statusChangedAt: days(100) }, now, Number.NaN)).toBe(false);
  });
  it("el texto que queda en lugar del archivo lleva fecha, nombre y tamaño", () => {
    const note = purgedNote({
      name: "captura.webp",
      bytes: 120_000,
      deletedAt: new Date("2026-12-01T15:00:00Z"),
    });
    expect(note).toBe("Adjunto borrado el 2026-12-01: captura.webp (117 KB)");
    expect(
      purgedNote({
        name: "informe.pdf",
        bytes: 2_500_000,
        deletedAt: new Date("2026-12-01T15:00:00Z"),
      }),
    ).toContain("2,4 MB");
  });
  it("el cron y la limpieza están apagados salvo ATTACHMENTS_PURGE_ENABLED=1", () => {
    expect(attachmentsPurgeEnabled({})).toBe(false);
    expect(attachmentsPurgeEnabled({ ATTACHMENTS_PURGE_ENABLED: "true" })).toBe(false);
    expect(attachmentsPurgeEnabled({ ATTACHMENTS_PURGE_ENABLED: "0" })).toBe(false);
    expect(attachmentsPurgeEnabled({ ATTACHMENTS_PURGE_ENABLED: " 1 " })).toBe(true);
  });
});

describe("feedbackFilesGlobalMaxBytes", () => {
  it("lee FEEDBACK_FILES_GLOBAL_MAX_MB y cae a 400 MB si es inválida", () => {
    expect(feedbackFilesGlobalMaxBytes({})).toBe(400 * 1024 * 1024);
    expect(feedbackFilesGlobalMaxBytes({ FEEDBACK_FILES_GLOBAL_MAX_MB: "200" })).toBe(
      200 * 1024 * 1024,
    );
    expect(feedbackFilesGlobalMaxBytes({ FEEDBACK_FILES_GLOBAL_MAX_MB: "abc" })).toBe(
      400 * 1024 * 1024,
    );
    expect(feedbackFilesGlobalMaxBytes({ FEEDBACK_FILES_GLOBAL_MAX_MB: "-5" })).toBe(
      400 * 1024 * 1024,
    );
  });
});
