import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  E2E_USER_ID,
  ensureSecondUser,
  login,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";
import { OFF_USER, ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";

/**
 * Flujo 321 (R29-04): los adjuntos del informe de revisión probados como los probaría quien los ataca. Todo con
 * personas y archivos inventados (los bytes se arman acá, mínimos), contra las rutas reales:
 * `POST /api/feedback-files`, `GET` y `DELETE /api/feedback-files/<id>`. La persona B es tester; el seed es admin;
 * la persona «OFF» no es ninguna de las dos.
 */
test.describe.configure({ mode: "serial" });

// ---------- bytes de prueba, generados acá ----------
const enc = (t: string) => Buffer.from(t, "utf8");
const u16 = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n: number) =>
  Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const chunk = (id: string, data: Buffer) =>
  Buffer.concat([
    enc(id),
    u32(data.length),
    data,
    data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
const riff = (...chunks: Buffer[]) => {
  const body = Buffer.concat([enc("WEBP"), ...chunks]);
  return Buffer.concat([enc("RIFF"), u32(body.length), body]);
};
const vp8l = (w: number, h: number) =>
  Buffer.concat([Buffer.from([0x2f]), u32((w - 1) | ((h - 1) << 14)), Buffer.alloc(8, 7)]);
const webp = (w = 32, h = 24) => riff(chunk("VP8L", vp8l(w, h)));
const webpWithExif = () =>
  riff(
    chunk("VP8X", Buffer.concat([Buffer.from([0x08, 0, 0, 0, 31, 0, 0, 23, 0, 0])])),
    chunk("VP8L", vp8l(32, 24)),
    chunk("EXIF", enc("GPS-inventado -34.6 -58.4")),
  );
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const pdf = (extra = "") =>
  enc(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog ${extra} >>\nendobj\n%%EOF\n`);

function zip(
  entries: { name: string; data?: Buffer; declared?: number; method?: number }[],
): Buffer {
  let offset = 0;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  for (const e of entries) {
    const data = e.data ?? enc("<x/>");
    const name = enc(e.name);
    const method = e.method ?? 0;
    const unc = e.declared ?? data.length;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(data.length),
      u32(unc),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(data.length),
        u32(unc),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}
const BASE_DOCX = [{ name: "[Content_Types].xml" }, { name: "word/document.xml" }];
const docx = (extra: { name: string; data?: Buffer; declared?: number; method?: number }[] = []) =>
  zip([...BASE_DOCX, ...extra]);

// ---------- datos y sesiones ----------
async function seedDraft(userId: string, status: "borrador" | "enviado" = "borrador") {
  const { db, close } = ownerDb();
  try {
    const [r] = await db
      .insert(s.feedbackReports)
      .values({ userId, status, sentAt: status === "borrador" ? null : new Date() })
      .returning({ id: s.feedbackReports.id });
    const [i] = await db
      .insert(s.feedbackItems)
      .values({
        reportId: r!.id,
        userId,
        position: 0,
        path: "/hoy",
        category: "idea",
        message: "Texto de prueba",
      })
      .returning({ id: s.feedbackItems.id });
    return { reportId: r!.id, itemId: i!.id };
  } finally {
    await close();
  }
}

async function cleanAll() {
  const { db, close } = ownerDb();
  try {
    const ids = [E2E_B_USER_ID, E2E_USER_ID, OFF_USER.id];
    await db.delete(s.feedbackReports).where(inArray(s.feedbackReports.userId, ids));
    await db.delete(s.blobFiles).where(inArray(s.blobFiles.userId, ids));
  } finally {
    await close();
  }
}

async function countBlobs(userId: string): Promise<number> {
  const { db, close } = ownerDb();
  try {
    return (
      await db
        .select({ id: s.blobFiles.id })
        .from(s.blobFiles)
        .where(eq(s.blobFiles.userId, userId))
    ).length;
  } finally {
    await close();
  }
}

type Who = "B" | "admin" | "off";
async function session(
  browser: Browser,
  who: Who,
): Promise<{ ctx: BrowserContext; origin: string }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (who === "B") await loginAsSecondUser(page);
  else if (who === "off") await loginAsOffUser(page);
  else await login(page);
  const origin = new URL(page.url()).origin;
  await page.close();
  return { ctx, origin };
}

type Part = { name: string; mimeType?: string; buffer: Buffer };
async function upload(ctx: BrowserContext, origin: string, itemId: string, file: Part | null) {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    itemId,
  };
  if (file) multipart.file = { mimeType: "application/octet-stream", ...file };
  const res = await ctx.request.post(`${origin}/api/feedback-files`, {
    multipart,
    headers: { origin },
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json: {
    ok?: boolean;
    error?: string;
    attachment?: { id: string; name: string; kind: string };
  } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // respuesta que no es JSON: los asserts de abajo lo marcan
  }
  return { status: res.status(), json, text };
}

test.beforeAll(async () => {
  await ensureSecondUser();
  await ensureOffUser();
  await cleanAll();
});
test.afterAll(async () => {
  await cleanAll();
  await removeOffUser();
  await removeSecondUser();
});

test("sin sesión: subir y descargar no devuelven nada (el middleware manda a /login o la ruta responde 401)", async ({
  request,
  baseURL,
}) => {
  // El middleware de la app redirige a /login todo pedido sin sesión (también /api/feedback-files): se mira
  // la primera respuesta, sin seguir la redirección.
  const closed = [301, 302, 303, 307, 308, 401];
  const up = await request.post(`${baseURL}/api/feedback-files`, {
    multipart: {
      itemId: "00000000-0000-4000-8000-000000000000",
      file: { name: "a.webp", mimeType: "image/webp", buffer: webp() },
    },
    headers: { origin: baseURL! },
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  expect(closed).toContain(up.status());
  const get = await request.get(
    `${baseURL}/api/feedback-files/00000000-0000-4000-8000-000000000000`,
    { failOnStatusCode: false, maxRedirects: 0 },
  );
  expect(closed).toContain(get.status());
  expect(get.headers()["content-type"] ?? "").not.toMatch(/webp|pdf|officedocument/);
});

test("una persona común (ni tester ni admin) no puede subir: 404, como si no existiera", async ({
  browser,
}) => {
  const { itemId } = await seedDraft(OFF_USER.id);
  const { ctx, origin } = await session(browser, "off");
  const r = await upload(ctx, origin, itemId, { name: "a.webp", buffer: webp() });
  expect(r.status).toBe(404);
  expect(r.json.ok).toBe(false);
  await ctx.close();
});

test("un pedido de otro origen se rechaza", async ({ browser }) => {
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { ctx, origin } = await session(browser, "B");
  const res = await ctx.request.post(`${origin}/api/feedback-files`, {
    multipart: { itemId, file: { name: "a.webp", mimeType: "image/webp", buffer: webp() } },
    headers: { origin: "https://sitio-malo.example" },
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(404);
  await ctx.close();
});

test("camino feliz: un WebP se guarda reescrito, sin EXIF, y se sirve con las cabeceras seguras", async ({
  browser,
}) => {
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { ctx, origin } = await session(browser, "B");
  const up = await upload(ctx, origin, itemId, {
    name: "../../captura.png",
    mimeType: "image/png",
    buffer: webpWithExif(),
  });
  expect(up.status).toBe(200);
  expect(up.json.attachment).toMatchObject({
    name: "captura.webp",
    kind: "image",
    width: 32,
    height: 24,
  });
  expect(up.text).not.toContain("pgb:");

  const get = await ctx.request.get(`${origin}/api/feedback-files/${up.json.attachment!.id}`);
  expect(get.status()).toBe(200);
  const h = get.headers();
  expect(h["content-type"]).toBe("image/webp");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toBe("sandbox");
  expect(h["cache-control"]).toBe("private, no-store");
  expect(h["content-disposition"]).toMatch(/^inline;/);
  const body = await get.body();
  expect(body.toString("latin1")).not.toContain("EXIF");
  expect(body.toString("latin1")).not.toContain("GPS");
  await ctx.close();
});

test("archivos disfrazados: SVG, HTML, PNG directo, GIF y vacío", async ({ browser }) => {
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { ctx, origin } = await session(browser, "B");
  const svg = await upload(ctx, origin, itemId, {
    name: "x.png",
    mimeType: "image/png",
    buffer: enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
  });
  expect([svg.status, svg.json.error]).toEqual([415, "type"]);
  const html = await upload(ctx, origin, itemId, {
    name: "x.png",
    mimeType: "image/png",
    buffer: enc("<html><script>alert(1)</script>"),
  });
  expect([html.status, html.json.error]).toEqual([415, "type"]);
  const polyglot = await upload(ctx, origin, itemId, {
    name: "x.png",
    mimeType: "image/png",
    buffer: Buffer.concat([PNG, enc("<script>alert(1)</script>")]),
  });
  expect([polyglot.status, polyglot.json.error]).toEqual([415, "image_reencode"]);
  const gif = await upload(ctx, origin, itemId, {
    name: "x.webp",
    mimeType: "image/webp",
    buffer: enc("GIF89a...."),
  });
  expect(gif.json.error).toBe("type");
  const empty = await upload(ctx, origin, itemId, { name: "x.webp", buffer: Buffer.alloc(0) });
  expect(empty.json.error).toBe("empty");
  expect(await countBlobs(E2E_B_USER_ID)).toBe(0); // nada se guardó
  await ctx.close();
});

test("PDF con JavaScript o acciones, DOCX con macro, bomba de compresión y polyglot", async ({
  browser,
}) => {
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { ctx, origin } = await session(browser, "B");
  for (const bad of [
    "/JavaScript (app.alert(1))",
    "/JS (x)",
    "/Launch",
    "/OpenAction 3 0 R",
    "/EmbeddedFile",
    "/J#61vaScript",
  ]) {
    const r = await upload(ctx, origin, itemId, {
      name: "a.pdf",
      mimeType: "application/pdf",
      buffer: pdf(bad),
    });
    expect([r.status, r.json.error]).toEqual([422, "unsafe_pdf"]);
  }
  const macro = await upload(ctx, origin, itemId, {
    name: "a.docx",
    buffer: docx([{ name: "word/vbaProject.bin" }]),
  });
  expect([macro.status, macro.json.error]).toEqual([422, "unsafe_docx"]);
  const ole = await upload(ctx, origin, itemId, {
    name: "a.docx",
    buffer: docx([{ name: "word/embeddings/oleObject1.bin" }]),
  });
  expect(ole.json.error).toBe("unsafe_docx");
  const bomb = await upload(ctx, origin, itemId, {
    name: "a.docx",
    buffer: docx([
      { name: "word/bomba.xml", data: Buffer.alloc(100), declared: 40 * 1024 * 1024, method: 8 },
    ]),
  });
  expect(bomb.json.error).toBe("unsafe_docx");
  const traversal = await upload(ctx, origin, itemId, {
    name: "a.docx",
    buffer: docx([{ name: "../../evil.xml" }]),
  });
  expect(traversal.json.error).toBe("unsafe_docx");
  const polyglot = await upload(ctx, origin, itemId, {
    name: "a.pdf",
    buffer: Buffer.concat([enc("%PDF-1.4\n"), docx()]),
  });
  expect(polyglot.json.error).toBe("unsafe_pdf");
  expect(await countBlobs(E2E_B_USER_ID)).toBe(0);
  await ctx.close();
});

test("PDF y DOCX limpios: se guardan, el nombre sale saneado y la descarga es attachment", async ({
  browser,
}) => {
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { ctx, origin } = await session(browser, "B");
  const p = await upload(ctx, origin, itemId, {
    name: "..\\..\\windows\\informe‮gpj.exe",
    buffer: pdf(),
  });
  expect(p.status).toBe(200);
  expect(p.json.attachment!.kind).toBe("pdf");
  expect(p.json.attachment!.name).toMatch(/^[^\\/‮]+\.pdf$/);
  const d = await upload(ctx, origin, itemId, { name: "tesis.docx", buffer: docx() });
  expect(d.status).toBe(200);
  for (const a of [p, d]) {
    const get = await ctx.request.get(`${origin}/api/feedback-files/${a.json.attachment!.id}`);
    expect(get.status()).toBe(200);
    expect(get.headers()["content-disposition"]).toMatch(/^attachment;/);
    expect(get.headers()["x-content-type-options"]).toBe("nosniff");
    expect(get.headers()["content-security-policy"]).toBe("sandbox");
  }
  await ctx.close();
});

test("el adjunto de otra persona: ni verlo ni borrarlo; el admin solo lo ve cuando se envió", async ({
  browser,
}) => {
  const { itemId, reportId } = await seedDraft(E2E_B_USER_ID);
  const b = await session(browser, "B");
  const up = await upload(b.ctx, b.origin, itemId, { name: "a.webp", buffer: webp() });
  const id = up.json.attachment!.id;

  const off = await session(browser, "off");
  const offGet = await off.ctx.request.get(`${off.origin}/api/feedback-files/${id}`, {
    failOnStatusCode: false,
  });
  const offDel = await off.ctx.request.delete(`${off.origin}/api/feedback-files/${id}`, {
    headers: { origin: off.origin },
    failOnStatusCode: false,
  });
  const missing = await off.ctx.request.get(
    `${off.origin}/api/feedback-files/00000000-0000-4000-8000-000000000999`,
    { failOnStatusCode: false },
  );
  expect(offGet.status()).toBe(404);
  expect(offDel.status()).toBe(404);
  // «no es tuyo» y «no existe» se ven igual
  expect(await offGet.text()).toBe(await missing.text());

  // El admin solo existe en el e2e con ADMIN_EMAILS (como en los flujos 46, 91 y 111)
  const admin = process.env.ADMIN_EMAILS ? await session(browser, "admin") : null;
  const { db, close } = ownerDb();
  if (admin) {
    await db.insert(s.appAdmins).values({ userId: E2E_USER_ID }).onConflictDoNothing();
    expect(
      (
        await admin.ctx.request.get(`${admin.origin}/api/feedback-files/${id}`, {
          failOnStatusCode: false,
        })
      ).status(),
    ).toBe(404); // borrador
  }
  await db
    .update(s.feedbackReports)
    .set({ status: "enviado", sentAt: new Date() })
    .where(eq(s.feedbackReports.id, reportId));
  await close();
  if (admin) {
    expect((await admin.ctx.request.get(`${admin.origin}/api/feedback-files/${id}`)).status()).toBe(
      200,
    );
    // enviado: el admin no puede borrar
    const adminDel = await admin.ctx.request.delete(`${admin.origin}/api/feedback-files/${id}`, {
      headers: { origin: admin.origin },
      failOnStatusCode: false,
    });
    expect(adminDel.status()).toBe(404);
  }
  // enviado: la dueña tampoco
  const ownDel = await b.ctx.request.delete(`${b.origin}/api/feedback-files/${id}`, {
    headers: { origin: b.origin },
    failOnStatusCode: false,
  });
  expect(ownDel.status()).toBe(409);
  // y no se suma nada a un informe enviado
  const late = await upload(b.ctx, b.origin, itemId, { name: "b.webp", buffer: webp() });
  expect([late.status, late.json.error]).toEqual([409, "report_locked"]);
  await Promise.all([b.ctx.close(), off.ctx.close(), admin?.ctx.close()]);
});

test("borrar el propio adjunto de un borrador también borra el archivo", async ({ browser }) => {
  await cleanAll();
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { ctx, origin } = await session(browser, "B");
  const up = await upload(ctx, origin, itemId, { name: "a.webp", buffer: webp() });
  expect(await countBlobs(E2E_B_USER_ID)).toBe(1);
  const del = await ctx.request.delete(`${origin}/api/feedback-files/${up.json.attachment!.id}`, {
    headers: { origin },
  });
  expect(del.status()).toBe(200);
  expect(await countBlobs(E2E_B_USER_ID)).toBe(0);
  expect(
    (
      await ctx.request.get(`${origin}/api/feedback-files/${up.json.attachment!.id}`, {
        failOnStatusCode: false,
      })
    ).status(),
  ).toBe(404);
  await ctx.close();
});

test("topes: 4 MB por pedido, 10 por ítem y, con dos subidas a la vez, no pasa el cupo", async ({
  browser,
}) => {
  await cleanAll();
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { ctx, origin } = await session(browser, "B");

  const big = await upload(ctx, origin, itemId, {
    name: "a.pdf",
    buffer: Buffer.concat([pdf(), Buffer.alloc(4 * 1024 * 1024 + 10)]),
  });
  expect([big.status, big.json.error]).toEqual([413, "request_too_large"]);
  const huge = await upload(ctx, origin, itemId, {
    name: "a.pdf",
    buffer: Buffer.alloc(6 * 1024 * 1024),
  });
  expect(huge.status).toBe(413);

  // 9 adjuntos (distintos para que no importe el contenido), después dos a la vez para el décimo lugar
  for (let n = 0; n < 9; n++) {
    const r = await upload(ctx, origin, itemId, { name: `c${n}.webp`, buffer: webp(10 + n, 10) });
    expect(r.status).toBe(200);
  }
  const [x, y] = await Promise.all([
    upload(ctx, origin, itemId, { name: "x.webp", buffer: webp(40, 10) }),
    upload(ctx, origin, itemId, { name: "y.webp", buffer: webp(41, 10) }),
  ]);
  expect([x.status, y.status].sort()).toEqual([200, 409]);
  const full = await upload(ctx, origin, itemId, { name: "z.webp", buffer: webp(42, 10) });
  expect([full.status, full.json.error]).toEqual([409, "item_full"]);
  await ctx.close();
});

test("límite de subidas por minuto: la número 21 espera", async ({ browser }) => {
  await cleanAll();
  const { itemId } = await seedDraft(E2E_B_USER_ID);
  const { db, close } = ownerDb();
  // 20 filas de metadatos recién creadas (en varios ítems, el tope de 10 es por ítem)
  const items = [itemId];
  const [r] = await db
    .select({ reportId: s.feedbackItems.reportId })
    .from(s.feedbackItems)
    .where(eq(s.feedbackItems.id, itemId));
  for (let p = 1; p <= 2; p++) {
    const [it] = await db
      .insert(s.feedbackItems)
      .values({
        reportId: r!.reportId,
        userId: E2E_B_USER_ID,
        position: p,
        path: "/hoy",
        category: "idea",
        message: "x",
      })
      .returning({ id: s.feedbackItems.id });
    items.push(it!.id);
  }
  const sha = "b".repeat(64);
  for (let n = 0; n < 20; n++) {
    await db.insert(s.feedbackAttachments).values({
      userId: E2E_B_USER_ID,
      itemId: items[1 + (n % 2)]!,
      originalName: `m${n}.pdf`,
      kind: "pdf",
      mime: "application/pdf",
      bytes: 100,
      sha256: sha,
    });
  }
  await close();
  const { ctx, origin } = await session(browser, "B");
  const r21 = await upload(ctx, origin, itemId, { name: "a.webp", buffer: webp() });
  expect([r21.status, r21.json.error]).toEqual([429, "rate_limited"]);
  await ctx.close();
});

test("tope de 100 MB por persona", async ({ browser }) => {
  await cleanAll();
  const { itemId, reportId } = await seedDraft(E2E_B_USER_ID);
  const { db, close } = ownerDb();
  const [it] = await db
    .insert(s.feedbackItems)
    .values({
      reportId,
      userId: E2E_B_USER_ID,
      position: 1,
      path: "/hoy",
      category: "idea",
      message: "x",
    })
    .returning({ id: s.feedbackItems.id });
  // 10 filas de 10 MB declarados = 100 MB (solo metadatos, sin archivo), con fecha de ayer para no tocar el ritmo
  for (let n = 0; n < 10; n++) {
    await db.insert(s.feedbackAttachments).values({
      userId: E2E_B_USER_ID,
      itemId: it!.id,
      originalName: `g${n}.pdf`,
      kind: "pdf",
      mime: "application/pdf",
      bytes: 10 * 1024 * 1024,
      sha256: "c".repeat(64),
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
  }
  await close();
  const { ctx, origin } = await session(browser, "B");
  const r = await upload(ctx, origin, itemId, { name: "a.webp", buffer: webp() });
  expect([r.status, r.json.error]).toEqual([413, "person_quota"]);
  await ctx.close();
});
