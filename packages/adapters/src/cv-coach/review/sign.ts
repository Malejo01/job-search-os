import { createHmac, timingSafeEqual } from "node:crypto";
import {
  cvCoachIssuesPayload,
  cvCoachSignedIssuesSchema,
  type CvCoachSignedIssues,
  type CvIssue,
} from "@job-search-os/pipeline";

/**
 * Firma y verificación de la lista de problemas del coach (ADR-038 §8). La lista no se guarda: viaja por
 * el navegador (`jso:coach:issues`) y vuelve en cada turno. El HMAC (subclave `cvcoach-issues-v1` de
 * `AUTH_SECRET`) cubre el JSON canónico de `v`, `flowId`, `expiresAt`, `target` e `issues`, atado al
 * `userId` de la sesión. Vence a las 2 h, como el ticket del agente de perfil. Sin `AUTH_SECRET` no se
 * firma ni se acepta nada (falla cerrado). Patrón de `profile-agent/ticket.ts`.
 */
export const CV_COACH_ISSUES_TTL_MS = 2 * 60 * 60 * 1000;

function subkey(secret: string): Buffer {
  return createHmac("sha256", secret).update("cvcoach-issues-v1").digest();
}

function mac(secret: string, userId: string, payload: string): string {
  return createHmac("sha256", subkey(secret))
    .update(`cvcoach|${userId}|${payload}`)
    .digest("base64url");
}

export function signCvCoachIssues(
  secret: string | undefined,
  userId: string,
  list: { flowId: string; target: string; issues: readonly CvIssue[] },
  nowMs: number,
): CvCoachSignedIssues | null {
  if (!secret || !userId) return null;
  const body = {
    v: 1 as const,
    flowId: list.flowId,
    expiresAt: Math.floor((nowMs + CV_COACH_ISSUES_TTL_MS) / 1000),
    target: list.target,
    issues: list.issues.map((i) => ({ ...i, ref: { ...i.ref } })),
  };
  const signed = { ...body, mac: mac(secret, userId, cvCoachIssuesPayload(body)) };
  // Lo que se firma tiene que poder volver: si no cumple el esquema, no se entrega
  return cvCoachSignedIssuesSchema.safeParse(signed).success ? signed : null;
}

/**
 * Verifica la lista que mandó el navegador: esquema estricto, firma, vencimiento y que sea de la misma
 * charla (`flowId` del ticket del agente de perfil). Cualquier diferencia → `null` (la ruta responde 409).
 */
export function verifyCvCoachIssues(
  secret: string | undefined,
  userId: string,
  raw: unknown,
  expected: { flowId: string; nowMs: number },
): CvCoachSignedIssues | null {
  if (!secret || !userId) return null;
  const parsed = cvCoachSignedIssuesSchema.safeParse(raw);
  if (!parsed.success) return null;
  const list = parsed.data;
  if (list.flowId !== expected.flowId) return null;
  const { mac: got, ...body } = list;
  const want = Buffer.from(mac(secret, userId, cvCoachIssuesPayload(body)));
  const actual = Buffer.from(got);
  if (want.length !== actual.length || !timingSafeEqual(want, actual)) return null;
  if (!(list.expiresAt * 1000 >= expected.nowMs)) return null;
  return list;
}
