import {
  CEFR_LEVELS,
  COUNTRY_OPTIONS,
  ISO_COUNTRY_CODES,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { ProfileForm } from "@/components/profile-form";
import { getProfileForEdit } from "@/lib/onboarding";
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
  const initial = await getProfileForEdit(userId);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Link href="/settings" className="text-sm text-zinc-900 underline">
        Ajustes
      </Link>
      <h1 className="text-2xl font-semibold">Tu perfil</h1>
      <p className="text-sm text-zinc-700">
        Modalidad, país, idioma de las ofertas, inglés, años y resumen. Con estos datos se filtran y
        evalúan los avisos. Los puestos se cambian en Ajustes, en «Tus puestos».
      </p>
      {initial ? (
        <ProfileForm
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
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          No se encontró tu perfil. Escribile a quien te invitó.
        </p>
      )}
    </div>
  );
}
