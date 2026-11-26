import { describe, expect, it } from "vitest";
import { listingTier, sortByListingTier, type ListingOrderInput } from "./order";

const base: ListingOrderInput = {
  evaluating: false,
  excludingNoMatch: false,
  goneFromSource: false,
};

describe("listingTier", () => {
  it("una oferta común va arriba (0)", () => {
    expect(listingTier(base)).toBe(0);
  });

  it("la que tiene una condición excluyente que no coincide baja (1)", () => {
    expect(listingTier({ ...base, excludingNoMatch: true })).toBe(1);
  });

  it("la que ya no figura en su fuente baja más (2)", () => {
    expect(listingTier({ ...base, goneFromSource: true })).toBe(2);
  });

  it("si pasan las dos, manda la que más baja", () => {
    expect(listingTier({ ...base, excludingNoMatch: true, goneFromSource: true })).toBe(2);
  });

  it("la que se está reevaluando no baja todavía", () => {
    expect(listingTier({ evaluating: true, excludingNoMatch: true, goneFromSource: true })).toBe(0);
  });
});

describe("sortByListingTier", () => {
  type Row = { id: string } & ListingOrderInput;
  const row = (id: string, over: Partial<ListingOrderInput> = {}): Row => ({
    id,
    ...base,
    ...over,
  });
  const ids = (rows: Row[]) => rows.map((r) => r.id);

  it("baja a las excluyentes y a las que ya no figuran, y respeta el orden de entrada dentro de cada grupo", () => {
    const rows = [
      row("a", { excludingNoMatch: true }),
      row("b"),
      row("c", { goneFromSource: true }),
      row("d"),
      row("e", { excludingNoMatch: true }),
      row("f", { goneFromSource: true }),
    ];
    expect(ids(sortByListingTier(rows, (r) => r))).toEqual(["b", "d", "a", "e", "c", "f"]);
  });

  it("no borra ni oculta ninguna", () => {
    const rows = [row("a", { goneFromSource: true }), row("b", { excludingNoMatch: true })];
    expect(sortByListingTier(rows, (r) => r)).toHaveLength(2);
  });

  it("no muta la lista de entrada", () => {
    const rows = [row("a", { excludingNoMatch: true }), row("b")];
    sortByListingTier(rows, (r) => r);
    expect(ids(rows)).toEqual(["a", "b"]);
  });

  it("lista vacía", () => {
    expect(sortByListingTier([], (r: Row) => r)).toEqual([]);
  });
});
