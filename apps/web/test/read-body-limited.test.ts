import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bodyBytesForChars, readBodyLimited } from "../lib/read-body-limited";

/** Cuerpo que cuenta cuántas veces se lo lee: `highWaterMark: 0` hace que no se pida nada hasta el primer `read`. */
function countingRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const pull = vi.fn();
  let i = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pull();
        const next = chunks[i++];
        if (next) controller.enqueue(next);
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("https://app.example/api/x", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
  return { request, pull };
}

const bytes = (n: number) => new Uint8Array(n).fill(97);

describe("readBodyLimited", () => {
  it("lee un cuerpo dentro del tope", async () => {
    const request = new Request("https://app.example/api/x", { method: "POST", body: "hola" });
    await expect(readBodyLimited(request, 100)).resolves.toEqual({ ok: true, text: "hola" });
  });

  it("sin cuerpo devuelve texto vacío", async () => {
    const request = new Request("https://app.example/api/x", { method: "POST" });
    await expect(readBodyLimited(request, 100)).resolves.toEqual({ ok: true, text: "" });
  });

  it("rechaza por Content-Length mayor al tope sin leer el cuerpo", async () => {
    const { request, pull } = countingRequest([bytes(10)], { "content-length": "5000" });
    const result = await readBodyLimited(request, 1000);
    expect(result).toEqual({ ok: false, reason: "too_large" });
    expect(pull).not.toHaveBeenCalled();
  });

  it("corta la lectura cuando el cuerpo real pasa el tope aunque no haya Content-Length", async () => {
    const { request, pull } = countingRequest(Array.from({ length: 50 }, () => bytes(100)));
    const result = await readBodyLimited(request, 250);
    expect(result).toEqual({ ok: false, reason: "too_large" });
    // 3 trozos de 100 ya pasan 250: no se siguió leyendo los 50
    expect(pull.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("corta aunque el Content-Length mienta (declara poco y manda mucho)", async () => {
    const { request } = countingRequest([bytes(400), bytes(400)], { "content-length": "10" });
    await expect(readBodyLimited(request, 500)).resolves.toEqual({ ok: false, reason: "too_large" });
  });

  it("un Content-Length ilegible no se confía: manda el cuerpo real", async () => {
    const small = countingRequest([bytes(10)], { "content-length": "mucho" });
    await expect(readBodyLimited(small.request, 100)).resolves.toMatchObject({ ok: true });
    const big = countingRequest([bytes(300)], { "content-length": "1e2" });
    await expect(readBodyLimited(big.request, 100)).resolves.toEqual({ ok: false, reason: "too_large" });
  });

  it("el tope es inclusivo: justo en el tope pasa", async () => {
    const request = new Request("https://app.example/api/x", { method: "POST", body: "a".repeat(100) });
    await expect(readBodyLimited(request, 100)).resolves.toMatchObject({ ok: true });
  });

  it("decodifica UTF-8 repartido entre trozos", async () => {
    const encoded = new TextEncoder().encode("ñandú");
    const { request } = countingRequest([encoded.slice(0, 1), encoded.slice(1)]);
    await expect(readBodyLimited(request, 100)).resolves.toEqual({ ok: true, text: "ñandú" });
  });

  it("2 MB contra un tope chico se rechazan en menos de 100 ms", async () => {
    const twoMb = bytes(2 * 1024 * 1024);
    // Por Content-Length
    const declared = new Request("https://app.example/api/x", {
      method: "POST",
      headers: { "content-length": String(twoMb.length) },
      body: twoMb,
    });
    let started = performance.now();
    await expect(readBodyLimited(declared, 8_000)).resolves.toEqual({ ok: false, reason: "too_large" });
    expect(performance.now() - started).toBeLessThan(100);

    // Sin Content-Length, en trozos de 64 KB
    const chunks = Array.from({ length: 32 }, () => bytes(64 * 1024));
    const { request } = countingRequest(chunks);
    started = performance.now();
    await expect(readBodyLimited(request, 8_000)).resolves.toEqual({ ok: false, reason: "too_large" });
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("bodyBytesForChars", () => {
  it("deja lugar a 4 bytes por carácter, para que el tope en caracteres de cada ruta siga mandando", () => {
    expect(bodyBytesForChars(8_000)).toBe(32_000);
  });
});

/** Todos los route.ts bajo `dir`. */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("las rutas de la API no leen el cuerpo sin tope", () => {
  const root = join(__dirname, "..", "app", "api");
  const routes = routeFiles(root);

  it("el recorrido encuentra las rutas", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("ninguna llama a request.text(), .json(), .formData(), .arrayBuffer() ni .blob() directo", () => {
    const offenders = routes.filter((file) =>
      /\b(request|req)\.(text|json|formData|arrayBuffer|blob)\(\)/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => f.slice(root.length + 1).replaceAll("\\", "/"))).toEqual([]);
  });
});
