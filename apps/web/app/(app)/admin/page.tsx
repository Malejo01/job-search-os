import Link from "next/link";
import { Alert, cardClasses } from "@/components/ui";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { ADMIN_SECTIONS } from "@/lib/admin-sections";
import { getPanelSummary } from "@/lib/people-admin";
import { requireUserId } from "@/lib/session";

/**
 * Portada del panel /admin (ADM-1): lo que está esperando una decisión (lista de espera, avisos de pago,
 * planes por vencer y feedback nuevo) y el resto de las secciones. Solo conteos.
 */
export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("es-AR");

export default async function AdminHomePage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const summary = await getPanelSummary(userId);

  const pending = summary
    ? [
        {
          n: summary.waitlist,
          label: "en la lista de espera sin invitar",
          href: "/admin/invitations#waitlist-heading",
          action: "Invitar",
        },
        {
          n: summary.paymentNotices,
          label: "avisos «Ya pagué» para confirmar",
          href: "/admin/planes#cola",
          action: "Revisar avisos",
        },
        {
          n: summary.expiring7d,
          label: "planes que vencen en 7 días",
          href: "/admin/personas?filtro=vencen_7",
          action: "Ver quiénes",
        },
        {
          n: summary.feedbackNew,
          label: "comentarios nuevos",
          href: "/admin/feedback",
          action: "Leer feedback",
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Panel de administración</h1>
        <p className="text-fg-muted">
          Quién tiene acceso, sus planes y cómo va la beta, sin entrar a la base.
        </p>
      </header>

      {summary === null ? (
        <Alert tone="warning" role="status">
          No se pudieron leer los pendientes. Si es la primera vez, falta aplicar la migración del
          panel (rls/0064) o tu cuenta no está en <code>app_admins</code>.
        </Alert>
      ) : (
        <>
          <section aria-labelledby="pendientes" className="flex flex-col gap-3">
            <h2 id="pendientes" className="text-heading font-medium">
              Para resolver
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {pending.map((p) => (
                <li
                  key={p.href}
                  className={cardClasses({ padding: "md", className: "flex flex-col gap-2" })}
                >
                  <p>
                    <span className="text-title font-bold tabular-nums">{nf.format(p.n)}</span>{" "}
                    <span className="text-fg-muted">{p.label}</span>
                  </p>
                  {p.n > 0 ? (
                    <Link
                      href={p.href}
                      className="inline-flex min-h-11 w-fit items-center font-semibold text-link underline underline-offset-2 hover:text-link-hover"
                    >
                      {p.action}
                    </Link>
                  ) : (
                    <p className="text-sm text-fg-subtle">Nada pendiente.</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="cuentas" className="flex flex-col gap-2">
            <h2 id="cuentas" className="text-heading font-medium">
              Cuentas
            </h2>
            <p className="text-fg-muted">
              <span className="font-semibold text-fg tabular-nums">
                {nf.format(summary.people)}
              </span>{" "}
              personas (sin las cuentas de prueba) ·{" "}
              <span className="font-semibold text-fg tabular-nums">{nf.format(summary.new7d)}</span>{" "}
              nuevas en los últimos 7 días ·{" "}
              <span className="font-semibold text-fg tabular-nums">
                {nf.format(summary.blocked)}
              </span>{" "}
              bloqueadas
            </p>
            <Link
              href="/admin/personas"
              className="inline-flex min-h-11 w-fit items-center font-semibold text-link underline underline-offset-2 hover:text-link-hover"
            >
              Ver todas las personas
            </Link>
          </section>
        </>
      )}

      <section aria-labelledby="secciones" className="flex flex-col gap-3">
        <h2 id="secciones" className="text-heading font-medium">
          Secciones
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_SECTIONS.filter((s) => s.id !== "inicio").map((s) => (
            <li key={s.id}>
              <Link
                href={s.href}
                className={cardClasses({
                  padding: "md",
                  className:
                    "flex min-h-11 flex-col gap-0.5 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
                })}
              >
                <span className="font-semibold">{s.label}</span>
                <span className="text-sm text-fg-muted">{s.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
