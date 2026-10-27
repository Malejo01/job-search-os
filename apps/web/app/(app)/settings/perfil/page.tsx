import {
  CEFR_LEVELS,
  COUNTRY_OPTIONS,
  ISO_COUNTRY_CODES,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { ProfileForm } from "@/components/profile-form";
import { getProfileForEdit, getTargetRoles } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { savePerfilAction } from "./actions";

export const metadata = { title: "Tu perfil" };
export const dynamic = "force-dynamic";

/**
 * «Tu perfil» (CV-00): edita lo que se cargó en el paso 1 del onboarding, salvo los puestos, que
 * siguen en Ajustes. Precargado con lo guardado; usa los mismos campos y validaciones.
 */
export default async function PerfilPage() {
  const userId = await requireUserId();
  const [initial, targetRoles] = await Promise.all([
    getProfileForEdit(userId),
    getTargetRoles(userId),
  ]);
  // Sin puestos guardados no se puede guardar el perfil, y acá no hay campo de puestos
  const rolesNotice = (
    <>
      Primero elegí tus puestos en{" "}
      <Link href="/settings" className="underline">
        Ajustes
      </Link>
      , en «Tus puestos», y volvé a guardar.
    </>
  );
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Link href="/settings" className="text-sm text-fg underline">
        Ajustes
      </Link>
      <h1 className="text-2xl font-semibold">Tu perfil</h1>
      <p className="text-sm text-fg-muted">
        Modalidad, país, idioma de las ofertas, inglés, años y resumen. Con estos datos se filtran y
        evalúan los avisos. Los puestos se cambian en Ajustes, en «Tus puestos».
      </p>
      {initial && targetRoles.length === 0 ? (
        <p role="note" className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          {rolesNotice}
        </p>
      ) : null}
      {initial ? (
        <ProfileForm
          rolesNotice={rolesNotice}
          action={savePerfilAction}
          initial={initial}
          countries={COUNTRY_OPTIONS}
          cefrLevels={CEFR_LEVELS}
          countryCodes={ISO_COUNTRY_CODES}
          minSummary={MIN_SUMMARY_CHARS}
          maxSummary={MAX_SUMMARY_CHARS}
          showLimits={false}
          submitLabel="Guardar"
          savedMessage="Guardado"
        />
      ) : (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          No se encontró tu perfil. Escribile a quien te invitó.
        </p>
      )}
    </div>
  );
}
