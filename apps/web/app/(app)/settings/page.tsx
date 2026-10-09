import { schema as s } from "@job-search-os/db";
import { isLegacyInboundAddress } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { withUser } from "@/lib/db";
import { getInboundAddress } from "@/lib/inbound-address";
import { requireUserId } from "@/lib/session";
import { DeleteAccountForm } from "./delete-account-form";
import { InboundAddressSection } from "./inbound-address";

export const dynamic = "force-dynamic";

/** Ajustes de la cuenta (JS-092): email, invitaciones y eliminación de la cuenta. Server Component. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; direccion?: string }>;
}) {
  const userId = await requireUserId();
  const { error, direccion } = await searchParams;
  const address = await getInboundAddress(userId);
  const [user] = await withUser(userId, (tx) =>
    tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Ajustes</h1>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
        <h2 className="text-lg font-medium">Cuenta</h2>
        <p className="text-sm text-zinc-700">
          Email: <span className="font-medium">{user?.email ?? "—"}</span>
        </p>
        <Link href="/settings/invitations" className="text-sm text-zinc-900 underline">
          Invitaciones
        </Link>

        <DeleteAccountForm error={Boolean(error)} />
      </section>

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
        <h2 className="text-lg font-medium">Criterios</h2>
        <Link href="/settings/criteria" className="text-sm text-zinc-900 underline">
          Editar mis criterios de evaluación
        </Link>
      </section>
    </div>
  );
}
