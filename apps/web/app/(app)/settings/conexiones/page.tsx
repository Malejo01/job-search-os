import { MCP_USER_TOKEN_MAX_ACTIVE } from "@job-search-os/adapters";
import { BRAND } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  buttonClasses,
  cardClasses,
  textLinkClasses,
  type BadgeTone,
} from "@/components/ui";
import { canUseMcpTokens, listMcpTokens, type McpTokenStatus } from "@/lib/mcp-tokens";
import { requireUserId } from "@/lib/session";
import { revokeMcpTokenAction } from "./actions";
import { CreateTokenForm } from "./create-token-form";

export const metadata: Metadata = { title: "Conexiones con chats", robots: { index: false } };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});
const SECTION = cardClasses({ padding: "md", className: "flex flex-col gap-3" });
const H2 = "text-heading font-bold";

const STATUS: Record<McpTokenStatus, { label: string; tone: BadgeTone }> = {
  activo: { label: "Activo", tone: "success" },
  vencido: { label: "Vencido", tone: "neutral" },
  revocado: { label: "Revocado", tone: "danger" },
};

/**
 * Conexiones con chats (MCP-1): tokens personales para conectar ChatGPT (u otro chat con MCP) a la
 * cuenta propia. Solo testers y con `MCP_USER_TOKENS=testers`; si no, 404. Server Component: el
 * único cliente es el formulario que muestra la URL una vez.
 */
export default async function ConexionesPage() {
  const userId = await requireUserId();
  if (!(await canUseMcpTokens(userId))) notFound();
  const tokens = await listMcpTokens(userId);
  const active = tokens.filter((t) => t.status === "activo").length;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <Link href="/settings" className={textLinkClasses({ className: "self-start text-sm" })}>
        ‹ Ajustes
      </Link>
      <h1 className="text-title font-bold">Conexiones con chats</h1>
      <p className="text-sm text-fg-muted">
        Conectá tu ChatGPT a tu cuenta para ver tus ofertas, pegar avisos y guardar respuestas desde
        el chat. El chat ve solo tus datos y nunca postula por vos. Lo que el chat lee de tu cuenta
        (perfil, respuestas fijas, ofertas) llega al proveedor de ese chat.
      </p>

      <section aria-labelledby="nueva-titulo" className={SECTION}>
        <h2 id="nueva-titulo" className={H2}>
          Nueva conexión
        </h2>
        <p className="text-sm text-fg-muted">
          Cada token vence a los 30 días. Podés tener hasta {MCP_USER_TOKEN_MAX_ACTIVE} activos.
        </p>
        <CreateTokenForm disabled={active >= MCP_USER_TOKEN_MAX_ACTIVE} />
      </section>

      <section aria-labelledby="tokens-titulo" className={SECTION}>
        <h2 id="tokens-titulo" className={H2}>
          Tus tokens
        </h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-fg-muted">Todavía no generaste ninguno.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="mcp-tokens">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 py-3 text-sm" data-testid="mcp-token">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold break-words">{t.label}</span>
                  <Badge tone={STATUS[t.status].tone} srLabel="Estado">
                    {STATUS[t.status].label}
                  </Badge>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-fg-muted">
                  <dt>Creado</dt>
                  <dd>{DATE.format(t.createdAt)}</dd>
                  <dt>Último uso</dt>
                  <dd>{t.lastUsedAt ? DATE.format(t.lastUsedAt) : "Nunca"}</dd>
                  <dt>{t.status === "vencido" ? "Venció" : "Vence"}</dt>
                  <dd>{DATE.format(t.expiresAt)}</dd>
                </dl>
                {t.status === "activo" ? (
                  <form action={revokeMcpTokenAction} className="self-start">
                    <input type="hidden" name="id" value={t.id} />
                    <button
                      type="submit"
                      className={buttonClasses({ variant: "secondary", size: "sm" })}
                    >
                      Revocar
                      <span className="sr-only"> «{t.label}»</span>
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-fg-muted">
          Si perdiste la URL o creés que alguien la vio, revocá el token y generá otro.
        </p>
      </section>

      <section aria-labelledby="chatgpt-titulo" className={SECTION}>
        <h2 id="chatgpt-titulo" className={H2}>
          Cómo conectarlo en ChatGPT
        </h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>Generá un token acá arriba y copiá la URL.</li>
          <li>
            En chatgpt.com (web, plan Plus o superior): Ajustes → Apps y conectores → Configuración
            avanzada → activá el Modo desarrollador. Los nombres pueden variar un poco según el
            idioma.
          </li>
          <li>
            En Apps y conectores, tocá Crear. Nombre: {BRAND.name}. URL del servidor MCP: pegá la
            URL. Autenticación: Sin autenticación. Tildá que confiás en la aplicación y guardá.
          </li>
          <li>
            Abrí un chat nuevo, tocá + → Modo desarrollador (o el ícono de herramientas) y activá{" "}
            {BRAND.name}.
          </li>
        </ol>
        <p className="text-sm text-fg-muted">
          Antes de cambiar algo (un estado, una respuesta, un aviso), ChatGPT te pide confirmación.
          Marcar una oferta como aplicada no postula: la postulación la hacés vos.
        </p>
      </section>
    </div>
  );
}
