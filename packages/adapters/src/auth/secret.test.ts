import { describe, expect, it } from "vitest";
import { checkBearerSecret } from "./secret";

describe("checkBearerSecret", () => {
  const expected = "secreto-de-ejemplo";

  it("acepta el Bearer correcto", () => {
    expect(checkBearerSecret({ authorization: `Bearer ${expected}`, expected })).toBe(true);
  });

  it("rechaza un secreto distinto, uno de otro largo y sin el prefijo Bearer", () => {
    expect(checkBearerSecret({ authorization: "Bearer otro-secreto-xx", expected })).toBe(false);
    expect(checkBearerSecret({ authorization: "Bearer x", expected })).toBe(false);
    expect(checkBearerSecret({ authorization: expected, expected })).toBe(false);
    expect(checkBearerSecret({ authorization: `Bearer ${expected}extra`, expected })).toBe(false);
  });

  it("falla cerrado sin header o sin secreto configurado", () => {
    expect(checkBearerSecret({ authorization: null, expected })).toBe(false);
    expect(checkBearerSecret({ authorization: undefined, expected })).toBe(false);
    expect(checkBearerSecret({ authorization: "Bearer ", expected: "" })).toBe(false);
    expect(checkBearerSecret({ authorization: "Bearer undefined", expected: undefined })).toBe(
      false,
    );
    expect(checkBearerSecret({ authorization: "Bearer null", expected: null })).toBe(false);
  });
});
