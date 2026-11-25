import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ withUser: vi.fn() }));
vi.mock("../lib/invitations", () => ({ canCreateInvitations: vi.fn(async () => false) }));

import {
  listFeedbackReports,
  groupReportRows,
  mapReportList,
  type RawDetail,
} from "../lib/admin-feedback-reports";

const ID_A = "11111111-1111-4111-8111-111111111111";

const row = (over: Partial<RawDetail>): RawDetail => ({
  report_id: "r1",
  person: "ab12cd",
  report_status: "enviado",
  sent_at: "2026-11-27T14:05:00Z",
  item_id: "i1",
  item_position: 0,
  path: "/hoy",
  category: "idea",
  message: "Texto",
  item_status: "nuevo",
  attachment_id: null,
  attachment_name: null,
  attachment_kind: null,
  attachment_bytes: null,
  attachment_width: null,
  attachment_height: null,
  ...over,
});

describe("groupReportRows", () => {
  it("sin filas no hay informe", () => {
    expect(groupReportRows([])).toBeNull();
  });

  it("une las filas por adjunto en ítems ordenados por posición", () => {
    const report = groupReportRows([
      row({ item_id: "i2", item_position: 1, message: "Segundo" }),
      row({
        item_id: "i1",
        item_position: 0,
        attachment_id: ID_A,
        attachment_name: "captura.webp",
        attachment_kind: "image",
        attachment_bytes: "120000",
        attachment_width: 800,
        attachment_height: 600,
      }),
      row({
        item_id: "i1",
        item_position: 0,
        attachment_id: "22222222-2222-4222-8222-222222222222",
        attachment_name: "informe.pdf",
        attachment_kind: "pdf",
        attachment_bytes: 5000,
      }),
    ])!;
    expect(report.person).toBe("ab12cd");
    expect(report.sentAt).toEqual(new Date("2026-11-27T14:05:00Z"));
    expect(report.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(report.items[0]!.attachments).toEqual([
      { id: ID_A, name: "captura.webp", kind: "image", bytes: 120000, width: 800, height: 600 },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "informe.pdf",
        kind: "pdf",
        bytes: 5000,
        width: null,
        height: null,
      },
    ]);
    expect(report.items[1]!.attachments).toEqual([]);
  });

  it("un tipo de adjunto desconocido no entra y un estado raro vuelve a «nuevo»", () => {
    const report = groupReportRows([
      row({
        attachment_id: ID_A,
        attachment_name: "x.svg",
        attachment_kind: "svg",
        item_status: "raro",
      }),
    ])!;
    expect(report.items[0]!.attachments).toEqual([]);
    expect(report.items[0]!.status).toBe("nuevo");
  });

  it("no expone email, nombre ni la ref del archivo", () => {
    const report = groupReportRows([row({})])!;
    expect(JSON.stringify(report)).not.toMatch(/@|pgb:|user_id/);
  });
});

describe("mapReportList", () => {
  it("convierte conteos y fechas, y un estado desconocido cae en «enviado»", () => {
    const [r] = mapReportList([
      {
        id: "r1",
        person: "ab12cd",
        status: "raro",
        sent_at: "2026-11-27T14:05:00Z",
        items: "3",
        screenshots: 2,
        documents: "1",
        items_new: 3,
      },
    ]);
    expect(r).toMatchObject({
      status: "enviado",
      items: 3,
      screenshots: 2,
      documents: 1,
      itemsNew: 3,
    });
    expect(r!.sentAt).toEqual(new Date("2026-11-27T14:05:00Z"));
  });
});

describe("listFeedbackReports", () => {
  it("una cuenta que no es admin no lee nada (falla cerrado antes de la base)", async () => {
    expect(await listFeedbackReports("u1")).toEqual({ ok: false, reason: "no_admin" });
  });
});
