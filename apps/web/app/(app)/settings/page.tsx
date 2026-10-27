import { schema as s } from "@job-search-os/db";
import { isLegacyInboundAddress, limitsText, pricingEnabled } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { withUser } from "@/lib/db";
import { getInboundAddress } from "@/lib/inbound-address";
import { canCreateInvitations } from "@/lib/invitations";
import { getTargetRoles, getTargetRolesLimit } from "@/lib/onboarding";
import { getUserPlan } from "@/lib/user-plan";
import { requireUserId } from "@/lib/session";
import { DeleteAccountForm } from "./delete-account-form";
import { InboundAddressSection } from "./inbound-address";
import { TargetRolesForm } from "./target-roles-form";

export const metadata = { title: "Ajustes" };

const PLAN_DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "America/Argentina/Buenos_Aires",
});
export const dynamic = "force-dynamic";
// «Tus puestos» puede programar la primera evaluación en after(): corre dentro de este límite
export const maxDuration = 120;

/** Ajustes de la cuenta (JS-092): email, invitaciones y eliminación de la cuenta. Server Component. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; direccion?: string; puesto?: string }>;
}) {
  const userId = await requireUserId();
  const { error, direccion, puesto } = await searchParams;
  const pricing = pricingEnabled(process.env);
  const [address, targetRoles, rolesLimit, canInvite, userPlan] = await Promise.all([
    getInboundAddress(userId),
    getTargetRoles(userId),
    getTargetRolesLimit(userId),
    canCreateInvitations(userId),
    // «Tu plan» (C-11b) solo con los precios encendidos
    pricing ? getUserPlan(userId) : null,
  ]);
  const [user] = await withUser(userId, (tx) =>
    tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Ajustes</h1>

      <Link
        href="/settings/perfil"
        className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line px-4 py-2 text-sm hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex flex-col">
          <span className="font-medium text-fg underline">Tu perfil</span>
          <span className="text-fg-muted">Modalidad, país, idioma de ofertas, resumen y años</span>
        </span>
        <span aria-hidden="true">›</span>
      </Link>

      <section className="flex flex-col gap-3 rounded-card border border-line p-4">
        <h2 className="text-lg font-medium">Cuenta</h2>
        <p className="text-sm text-fg-muted">
          Email: <span className="font-medium">{user?.email ?? "—"}</span>
        </p>
        <DeleteAccountForm error={Boolean(error)} />
      </section>

      {userPlan ? (
        <section
          aria-labelledby="tu-plan"
          data-testid="tu-plan"
          className="flex flex-col gap-2 rounded-card border border-line p-4"
        >
          <h2 id="tu-plan" className="text-lg font-medium">
            Tu plan
          </h2>
          <p className="text-sm text-fg">
            <span className="font-medium">{userPlan.plan.name}</span>
            {userPlan.until ? ` · hasta el ${PLAN_DATE.format(userPlan.until)}` : ""}
          </p>
          {userPlan.expired ? (
            <p className="text-sm text-warning">
              Tu plan anterior venció: ahora rigen los topes del plan gratis.
            </p>
          ) : null}
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
            {limitsText(userPlan.plan.limits, {
              cv: process.env.CV_IMPORT_ENABLED === "1",
              assistant: false,
            }).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Link href="/precios" className="text-sm text-fg underline">
            Ver los planes
          </Link>
        </section>
      ) : null}

      {canInvite ? (
        <section className="flex flex-col gap-3 rounded-card border border-line p-4">
          <h2 className="text-lg font-medium">Invitar a alguien</h2>
          <p className="text-sm text-fg-muted">Mandale un link a quien quieras sumar a la beta.</p>
          <Link
            href="/settings/invitations"
            className="inline-flex min-h-11 items-center self-start rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Crear invitación
          </Link>
          {/* C-14: el tablero de la beta es para las mismas cuentas que invitan */}
          <Link href="/settings/metricas" className="text-sm text-fg underline">
            Métricas de la beta
          </Link>
        </section>
      ) : null}

      <TargetRolesForm
        current={targetRoles}
        limit={rolesLimit}
        status={puesto === "guardado" ? puesto : undefined}
      />

      <InboundAddressSection
        address={address}
        legacy={address !== null && isLegacyInboundAddress(address, userId)}
        notice={direccion === "nueva" || direccion === "sin_dominio" ? direccion : undefined}
      />

      <Link href="/settings/asistente" className="text-sm text-fg underline">
        Asistente de email
      </Link>

      <section className="flex flex-col gap-3 rounded-card border border-line p-4">
        <h2 className="text-lg font-medium">Remitentes</h2>
        <p className="text-sm text-fg-muted">
          Qué dominios son fuentes de empleo y se guardan completos.
        </p>
        <Link href="/settings/senders" className="text-sm text-fg underline">
          Ver y cambiar remitentes
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line p-4">
        <h2 className="text-lg font-medium">Skills</h2>
        <Link href="/settings/skills" className="text-sm text-fg underline">
          Mis skills
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line p-4">
        <h2 className="text-lg font-medium">Criterios</h2>
        <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Avanzado</p>
        <p className="text-sm text-fg-muted">
          Cambiar estos criterios puede hacer que se descarten ofertas que te sirven. Si no estás
          segura o seguro, dejalos como están.
        </p>
        <Link href="/settings/criteria" className="text-sm text-fg underline">
          Editar mis criterios de evaluación
        </Link>
      </section>
    </div>
  );
}
