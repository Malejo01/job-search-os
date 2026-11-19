import { describe, expect, it, vi } from "vitest";
import {
  fetchReceivedEmail,
  loadInboundContent,
  RESEND_FETCH_TIMEOUT_MS,
  ResendFetchError,
} from "./resend";

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const logger = { warn: vi.fn() };

describe("fetchReceivedEmail", () => {
  it("devuelve el cuerpo cuando la API responde bien", async () => {
    const content = await fetchReceivedEmail(
      "em_1",
      "clave-de-prueba",
      respond(200, { html: "<p>hola</p>", text: "hola", headers: { a: "b" } }),
    );
    expect(content).toEqual({ html: "<p>hola</p>", text: "hola", headers: { a: "b" } });
  });

  it("pide el cuerpo con un tiempo máximo", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const impl = respond(200);
    await fetchReceivedEmail("em_1", "clave-de-prueba", impl);
    expect(timeout).toHaveBeenCalledWith(RESEND_FETCH_TIMEOUT_MS);
    const init = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it.each([429, 500, 502, 503])("con HTTP %i el error se puede reintentar", async (status) => {
    const error = await fetchReceivedEmail("em_1", "clave-de-prueba", respond(status)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ResendFetchError);
    expect((error as ResendFetchError).retryable).toBe(true);
    expect((error as ResendFetchError).status).toBe(status);
  });

  it.each([400, 401, 403, 404])("con HTTP %i el error no se reintenta", async (status) => {
    const error = await fetchReceivedEmail("em_1", "clave-de-prueba", respond(status)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ResendFetchError);
    expect((error as ResendFetchError).retryable).toBe(false);
  });

  it("una falla de red o un tiempo agotado se puede reintentar", async () => {
    const impl = vi.fn(async () => {
      throw new DOMException("tiempo agotado", "TimeoutError");
    }) as unknown as typeof fetch;
    const error = await fetchReceivedEmail("em_1", "clave-de-prueba", impl).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ResendFetchError);
    expect((error as ResendFetchError).retryable).toBe(true);
  });

  it("el mensaje del error no incluye el id del email", async () => {
    const error = await fetchReceivedEmail("em_secreto", "clave-de-prueba", respond(429)).catch(
      (e: unknown) => e,
    );
    expect((error as Error).message).not.toContain("em_secreto");
  });
});

describe("loadInboundContent", () => {
  it("relanza lo que se puede reintentar", async () => {
    await expect(
      loadInboundContent("em_1", "clave-de-prueba", logger, respond(429)),
    ).rejects.toBeInstanceOf(ResendFetchError);
  });

  it("sigue sin cuerpo si el email no se puede recuperar", async () => {
    await expect(
      loadInboundContent("em_1", "clave-de-prueba", logger, respond(404)),
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});
