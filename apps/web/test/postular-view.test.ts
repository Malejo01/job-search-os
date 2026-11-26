import { describe, expect, it } from "vitest";
import { httpsUrl, postularChecklist } from "../app/(app)/jobs/[id]/postular/postular-view";

describe("httpsUrl", () => {
  it("acepta https y devuelve la URL normalizada", () => {
    expect(httpsUrl("https://jobs.example/aviso/1")).toBe("https://jobs.example/aviso/1");
  });

  it("rechaza http, javascript, data, vacío y basura", () => {
    for (const bad of [
      "http://jobs.example/aviso",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "//jobs.example/aviso",
      "jobs.example/aviso",
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(httpsUrl(bad)).toBeNull();
    }
  });

  it("rechaza URLs con usuario o contraseña y las demasiado largas", () => {
    expect(httpsUrl("https://user:clave@jobs.example/")).toBeNull();
    expect(httpsUrl(`https://jobs.example/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("postularChecklist", () => {
  it("siempre termina en enviar en el sitio y marcar «Ya me postulé»", () => {
    for (const hasAnswers of [true, false]) {
      for (const hasCover of [true, false]) {
        const keys = postularChecklist({ hasAnswers, hasCover }).map((i) => i.key);
        expect(keys).toEqual(["cv", "answers", "cover", "portal", "mark"]);
      }
    }
  });

  it("cambia el texto según lo que ya hay preparado", () => {
    const sin = postularChecklist({ hasAnswers: false, hasCover: false });
    const con = postularChecklist({ hasAnswers: true, hasCover: true });
    expect(sin[1]?.text).not.toBe(con[1]?.text);
    expect(sin[2]?.text).not.toBe(con[2]?.text);
  });
});
