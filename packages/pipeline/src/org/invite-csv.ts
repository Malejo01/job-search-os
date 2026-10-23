import { z } from "zod";

/**
 * Invitación por planilla de una institución (C-16 §2, ticket B2B-2). Puro y **falla cerrado**: con
 * cualquier problema (encabezado desconocido, más de dos columnas, fila sin email, email inválido,
 * duplicado dentro del archivo o archivo demasiado grande) devuelve todos los errores con su línea y
 * no se crea nada. Las cohortes se resuelven después, en el servidor, por nombre exacto.
 */
export const INVITE_CSV_MAX_ROWS = 200;
export const INVITE_CSV_MAX_BYTES = 64 * 1024;

export type InviteCsvRow = { line: number; email: string; cohort: string | null };

export type InviteCsvErrorReason =
  "vacio" | "muy_grande" | "muchas_filas" | "encabezado" | "columnas" | "email" | "duplicado";

export type InviteCsvError = { line: number; reason: InviteCsvErrorReason };

export type InviteCsvResult =
  { ok: true; rows: InviteCsvRow[] } | { ok: false; errors: InviteCsvError[] };

// Mismo criterio que el registro (invitations-core.ts): trim + minúsculas y z.email() de hasta 254
const emailSchema = z.email().max(254);
const normalize = (email: string) => email.trim().toLowerCase();
// Marca de orden de bytes que agrega Excel al principio, armada por código para no tenerla literal
const BOM = String.fromCharCode(0xfeff);

/** Celdas de una línea, con comillas RFC 4180; acepta «,» o «;» (Excel en español usa «;»). */
function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted && c === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && (c === "," || c === ";")) {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map((s) => s.trim());
}

const HEADERS = new Set(["email", "email,cohorte"]);

export function parseInviteCsv(raw: string): InviteCsvResult {
  if (new TextEncoder().encode(raw).length > INVITE_CSV_MAX_BYTES) {
    return { ok: false, errors: [{ line: 0, reason: "muy_grande" }] };
  }
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/).map((t, i) => ({ text: t, line: i + 1 }));
  const filled = lines.filter((l) => l.text.trim());
  if (!filled.length) return { ok: false, errors: [{ line: 0, reason: "vacio" }] };

  const first = splitLine(filled[0]!.text).map((c) => c.toLowerCase());
  const hasHeader = !first[0]?.includes("@");
  if (hasHeader && !HEADERS.has(first.join(","))) {
    return { ok: false, errors: [{ line: filled[0]!.line, reason: "encabezado" }] };
  }
  const body = hasHeader ? filled.slice(1) : filled;
  if (!body.length) return { ok: false, errors: [{ line: 0, reason: "vacio" }] };
  if (body.length > INVITE_CSV_MAX_ROWS) {
    return { ok: false, errors: [{ line: 0, reason: "muchas_filas" }] };
  }
  return checkRows(body);
}

function checkRows(body: { text: string; line: number }[]): InviteCsvResult {
  const errors: InviteCsvError[] = [];
  const rows: InviteCsvRow[] = [];
  const seen = new Set<string>();
  for (const { text, line } of body) {
    const cells = splitLine(text);
    const email = normalize(cells[0] ?? "");
    let reason: InviteCsvErrorReason | null = null;
    if (cells.length > 2) {
      reason = "columnas";
    } else if (!emailSchema.safeParse(email).success) {
      reason = "email";
    } else if (seen.has(email)) {
      reason = "duplicado";
    }
    if (reason) {
      errors.push({ line, reason });
      continue;
    }
    seen.add(email);
    rows.push({ line, email, cohort: cells[1] || null });
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
