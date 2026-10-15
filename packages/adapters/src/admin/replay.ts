import { schema as s, type Db } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { handleInboundEmail } from "../inbound/handle";
import type { ReceivedEmailContent, ResendReceivedEvent } from "../inbound/resend";
import type { Logger } from "../logger";
import { pgBlobStorage } from "../storage/blob";
import { normalizeEmail, parseEmail, type Parsed } from "./common";

/**
 * inbound:replay — reproduce un email SINTÉTICO por el mismo camino que el webhook de Resend
 * después de verificar la firma: crudo en storage + fila en inbound_emails + despacho por remitente.
 */

export type ReplayArgs = { fixture: string; to: string; remote: boolean };

export function parseReplayArgs(argv: string[]): Parsed<ReplayArgs> {
  const usage = "uso: inbound:replay <fixture.json> --to <email-de-usuario> [--remote]";
  let parsed: { values: { to?: string; remote?: boolean }; positionals: string[] };
  try {
    const options = { to: { type: "string" }, remote: { type: "boolean" } } as const;
    parsed = parseArgs({ args: argv, options, strict: true, allowPositionals: true });
  } catch {
    return { ok: false, error: usage };
  }
  const [fixture, ...extra] = parsed.positionals;
  if (!fixture || extra.length > 0) return { ok: false, error: usage };
  const to = parseEmail(parsed.values.to);
  if (!to) return { ok: false, error: "falta --to <email-de-usuario> (con un email válido)" };
  return { ok: true, fixture, to, remote: parsed.values.remote === true };
}

/** Fixture sintético: o `html` en línea, o `htmlFile` relativo al JSON (para reusar los HTML públicos). */
export const ReplayFixtureSchema = z
  .object({
    from: z.string().min(1),
    subject: z.string().min(1),
    html: z.string().optional(),
    htmlFile: z.string().min(1).optional(),
    text: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((f) => (f.html === undefined) !== (f.htmlFile === undefined), {
    message: "tiene que traer html o htmlFile (uno solo)",
  });
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;

export type LoadedFixture = { fixture: ReplayFixture; html: string };

/** Lee y valida el fixture; resuelve `htmlFile` contra la carpeta del JSON. Error claro si algo falla. */
export function loadReplayFixture(
  path: string,
  env: Record<string, string | undefined> = process.env,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): { ok: true; loaded: LoadedFixture } | { ok: false; error: string } {
  const full = resolve(env.INIT_CWD ?? process.cwd(), path);
  let json: unknown;
  try {
    json = JSON.parse(readFile(full));
  } catch {
    return { ok: false, error: `no se pudo leer el fixture (${path}) como JSON` };
  }
  const result = ReplayFixtureSchema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `fixture inválido: ${detail}` };
  }
  const fixture = result.data;
  if (fixture.html !== undefined) return { ok: true, loaded: { fixture, html: fixture.html } };
  try {
    return {
      ok: true,
      loaded: { fixture, html: readFile(resolve(dirname(full), fixture.htmlFile!)) },
    };
  } catch {
    return { ok: false, error: "fixture inválido: no se pudo leer htmlFile" };
  }
}

export type ReplayDestination = "ingestado" | "cola manual" | "descartado" | "sin avisos";

export type ReplayResult =
  | { ok: false; error: string }
  | {
      ok: true;
      inboundId: string;
      parser: string | null;
      jobsExtracted: number;
      destination: ReplayDestination;
    };

export type ReplayDeps = { db: Db; logger: Logger; now?: () => Date };

/** Arma el evento y el contenido y llama a handleInboundEmail (el mismo despacho que el webhook). */
export async function replayInbound(
  loaded: LoadedFixture,
  toEmail: string,
  deps: ReplayDeps,
): Promise<ReplayResult> {
  const { db } = deps;
  const [user] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(sql`lower(${s.users.email})`, normalizeEmail(toEmail)))
    .limit(1);
  if (!user) return { ok: false, error: "no existe un usuario con el email de --to" };
  const [profile] = await db
    .select({ inboundAddress: s.profiles.inboundAddress })
    .from(s.profiles)
    .where(eq(s.profiles.userId, user.id))
    .limit(1);
  if (!profile)
    return { ok: false, error: "el usuario no tiene perfil (onboarding sin completar)" };

  const now = deps.now?.() ?? new Date();
  const event: ResendReceivedEvent = {
    type: "email.received",
    created_at: now.toISOString(),
    data: {
      email_id: `replay-${randomUUID()}`,
      from: loaded.fixture.from,
      to: [profile.inboundAddress],
      cc: [],
      bcc: [],
      received_for: [profile.inboundAddress],
      subject: loaded.fixture.subject,
      attachments: [],
    },
  };
  const content: ReceivedEmailContent = {
    html: loaded.html,
    text: loaded.fixture.text ?? null,
    headers: loaded.fixture.headers ?? null,
  };
  const out = await handleInboundEmail(event, content, JSON.stringify(event), {
    db,
    storage: pgBlobStorage(db),
    logger: deps.logger,
    now: deps.now,
  });
  if (out.kind !== "stored") {
    // Con un email_id nuevo y la dirección del propio usuario, solo puede ser el límite horario
    return { ok: false, error: `el despacho no guardó el email (${out.kind})` };
  }
  const [row] = await db
    .select({ dismissedAt: s.inboundEmails.dismissedAt, error: s.inboundEmails.error })
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.id, out.inboundId))
    .limit(1);
  const destination: ReplayDestination = row?.dismissedAt
    ? "descartado"
    : row?.error
      ? "cola manual"
      : out.jobsExtracted > 0
        ? "ingestado"
        : "sin avisos";
  return {
    ok: true,
    inboundId: out.inboundId,
    parser: out.parser,
    jobsExtracted: out.jobsExtracted,
    destination,
  };
}
