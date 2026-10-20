import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Headers de seguridad globales (ronda 64). La CSP es solo frame-ancestors.
const COMMON = {
  "x-content-type-options": "nosniff",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
};
const GLOBAL = { ...COMMON, "referrer-policy": "strict-origin-when-cross-origin" };

test.describe("headers de seguridad", () => {
  for (const path of ["/", "/login"]) {
    test(`${path} lleva los cinco headers`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response).not.toBeNull();
      expect(response!.headers()).toMatchObject(GLOBAL);
    });
  }

  test("/jobs con sesión lleva los cinco headers", async ({ page }) => {
    await login(page);
    // Se mide la respuesta final de /jobs, ya sin el redirect de login
    const response = await page.goto("/jobs");
    expect(response).not.toBeNull();
    expect(response!.headers()).toMatchObject(GLOBAL);
  });

  test("/reset-password mantiene no-referrer y los otros cuatro", async ({ page }) => {
    const response = await page.goto("/reset-password");
    expect(response).not.toBeNull();
    expect(response!.headers()).toMatchObject({ ...COMMON, "referrer-policy": "no-referrer" });
  });

  test("/api/health lleva nosniff", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
