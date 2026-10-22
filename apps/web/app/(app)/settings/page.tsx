import { schema as s } from "@job-search-os/db";
import { isLegacyInboundAddress } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { withUser } from "@/lib/db";
import { getInboundAddress } from "@/lib/inbound-address";
import { canCreateInvitations } from "@/lib/invitations";
import { getTargetRoles, getTargetRolesLimit } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { DeleteAccountForm } from "./delete-account-form";
import { InboundAddressSection } from "./inbound-address";
import { TargetRolesForm } from "./target-roles-form";

export const metadata = { title: "Ajustes" };
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
  const [address, targetRoles, rolesLimit, canInvite] = await Promise.all([
    getInboundAddress(userId),
    getTargetRoles(userId),
    getTargetRolesLimit(userId),
    canCreateInvitations(userId),
  ]);
  const [user] = await withUser(userId, (tx) =>
    tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Ajustes</h1>

      <Link
        href="/settings/perfil"
        className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        <span className="flex flex-col">
          <span className="font-medium text-zinc-900 underline">Tu perfil</span>
          <span className="text-zinc-700">Modalidad, país, idioma de ofertas, resumen y años</span>
        </span>
        <span aria-hidden="true">›</span>
      </Link>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
        <h2 className="text-lg font-medium">Cuenta</h2>
        <p className="text-sm text-zinc-700">
          Email: <span className="font-medium">{user?.email ?? "—"}</span>
        </p>
        <DeleteAccountForm error={Boolean(error)} />
      </section>

      {canInvite ? (
        <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
          <h2 className="text-lg font-medium">Invitar a alguien</h2>
          <p className="text-sm text-zinc-700">Mandale un link a quien quieras sumar a la beta.</p>
          <Link
            href="/settings/invitations"
            className="inline-flex min-h-11 items-center self-start rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Crear invitación
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

      <Link href="/settings/asistente" className="text-sm text-zinc-900 underline">
        Asistente de email
      </Link>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
        <h2 className="text-lg font-medium">Remitentes</h2>
        <p className="text-sm text-zinc-700">
          Qué dominios son fuentes de empleo y se guardan completos.
        </p>
        <Link href="/settings/senders" className="text-sm text-zinc-900 underline">
          Ver y cambiar remitentes
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
        <h2 className="text-lg font-medium">Skills</h2>
        <Link href="/settings/skills" className="text-sm text-zinc-900 underline">
          Mis skills
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
        <h2 className="text-lg font-medium">Criterios</h2>
        <p className="text-xs font-semibold tracking-wide text-zinc-700 uppercase">Avanzado</p>
        <p className="text-sm text-zinc-700">
          Cambiar estos criterios puede hacer que se descarten ofertas que te sirven. Si no estás
          segura o seguro, dejalos como están.
        </p>
        <Link href="/settings/criteria" className="text-sm text-zinc-900 underline">
          Editar mis criterios de evaluación
        </Link>
      </section>
    </div>
  );
}
