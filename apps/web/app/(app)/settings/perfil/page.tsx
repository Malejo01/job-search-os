import {
  CEFR_LEVELS,
  COUNTRY_OPTIONS,
  ISO_COUNTRY_CODES,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { ProfileFormWithProposal } from "@/components/profile-form-with-proposal";
import { getProfileForEdit, getTargetRoles } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { Alert, textLinkClasses } from "@/components/ui";
import { MoreNav } from "../../more-nav";
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
      Primero{" "}
      <Link href="/settings#puesto" className="font-semibold underline underline-offset-2">
        elegí tus puestos
      </Link>{" "}
      y volvé a guardar.
    </>
  );
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/settings" className={textLinkClasses({ block: true, className: "text-sm" })}>
        Ajustes
      </Link>
      <h1 className="text-title font-bold">Tu perfil</h1>
      <p className="text-sm text-fg-muted">
        Modalidad, país, idioma de las ofertas, inglés, años y resumen. Con estos datos se filtran y
        evalúan los avisos. Los puestos se cambian en Ajustes, en «Tus puestos».
      </p>
      {/* R11-13: en el celular «Más» va después del formulario, que ya no queda debajo del pliegue */}
      <div className="order-last sm:order-none">
        <MoreNav />
      </div>
      {initial && targetRoles.length === 0 ? (
        <Alert tone="warning" role="note">
          <p>{rolesNotice}</p>
        </Alert>
      ) : null}
      {initial ? (
        <ProfileFormWithProposal
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
        <Alert tone="danger" role="alert">
          No encontramos tu perfil. Escribile a quien te invitó.
        </Alert>
      )}
    </div>
  );
}
