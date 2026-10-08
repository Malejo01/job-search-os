import {
  CEFR_LEVELS,
  COUNTRY_OPTIONS,
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
  OTHER_COUNTRY,
} from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { DeleteAccountForm } from "../(app)/settings/delete-account-form";
import { saveOnboardingAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "rounded-md border border-zinc-300 px-3 py-2 text-base";

const FIELD_ERRORS: Record<string, string> = {
  country: "Elegí tu país.",
  countryOther: "Escribí el código de país de 2 letras (por ejemplo PT).",
  city: "La ciudad es demasiado larga.",
  workAuthOther: "El campo de otras autorizaciones es demasiado largo.",
  englishCefr: "Elegí tu nivel de inglés.",
  yearsTotal: "Los años de experiencia tienen que ser un número entre 0 y 60.",
  salaryFloorUsd: "El piso salarial tiene que ser un número entero en USD (o dejalo vacío).",
  maxWeeklyHours: "Las horas máximas tienen que ser un entero entre 1 y 80 (o dejalo vacío).",
  summary: `El resumen necesita al menos ${MIN_SUMMARY_CHARS} caracteres.`,
  perfil: "No se encontró tu perfil. Escribile a quien te invitó.",
};

/**
 * Onboarding obligatorio (B2, JS-094): sin país, resumen y criterios el evaluador no tiene con
 * qué trabajar. El gate está en el layout de (app); si el perfil ya está completo, va a /jobs.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  if (await isOnboardingComplete(userId)) redirect("/jobs");
  const { error } = await searchParams;
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Completá tu perfil</h1>
      <p className="text-sm text-zinc-600">
        Antes de ver ofertas necesitamos unos datos: con ellos se filtran y evalúan los avisos. Los
        podés cambiar más adelante.
      </p>
      {error && error !== "confirmacion" ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {FIELD_ERRORS[error] ?? "Revisá los datos del formulario."}
        </p>
      ) : null}
      <form action={saveOnboardingAction} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            País de residencia *
            <select name="country" required defaultValue="" className={input}>
              <option value="" disabled>
                Elegí uno
              </option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
              <option value={OTHER_COUNTRY}>Otro (escribí el código abajo)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Otro país: código de 2 letras
            <input
              name="countryOther"
              maxLength={2}
              placeholder="PT"
              autoComplete="off"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ciudad (opcional)
            <input name="city" maxLength={100} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Inglés (nivel CEFR) *
            <select name="englishCefr" required defaultValue="" className={input}>
              <option value="" disabled>
                Elegí uno
              </option>
              {CEFR_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Años de experiencia *
            <input
              name="yearsTotal"
              type="number"
              min={0}
              max={60}
              step="0.5"
              required
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Piso salarial mensual en USD (opcional)
            <input name="salaryFloorUsd" type="number" min={0} step={1} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Horas máximas por semana (opcional)
            <input
              name="maxWeeklyHours"
              type="number"
              min={1}
              max={80}
              step={1}
              className={input}
            />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">Autorización de trabajo</legend>
          <label className="flex items-center gap-2">
            <input name="remoteOnly" type="checkbox" defaultChecked /> Busco solo trabajo remoto
          </label>
          <label className="flex items-center gap-2">
            <input name="workAuthUs" type="checkbox" /> Puedo trabajar en EE.UU. sin sponsorship
          </label>
          <label className="flex items-center gap-2">
            <input name="workAuthEu" type="checkbox" /> Puedo trabajar en la Unión Europea sin
            sponsorship
          </label>
          <label className="flex flex-col gap-1">
            Otros países donde puedo trabajar (opcional, separados por coma)
            <input name="workAuthOther" maxLength={200} placeholder="CA, MX" className={input} />
          </label>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          Resumen de tu perfil * (mínimo {MIN_SUMMARY_CHARS} caracteres)
          <textarea
            name="summary"
            rows={9}
            required
            minLength={MIN_SUMMARY_CHARS}
            maxLength={MAX_SUMMARY_CHARS}
            className={input}
          />
        </label>
        <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <p className="font-medium">Qué poner</p>
          <p>
            Tu rol y años de experiencia; qué dominás con proyectos en producción, qué usaste pero
            no sostenés como stack principal, y qué casi no conocés. Ser honesto con lo que no sabés
            evita que te recomienden avisos que no podés cubrir. Ejemplo inventado:
            &ldquo;Desarrolladora backend con 6 años, Python y PostgreSQL en producción; intermedio
            en Docker y AWS; sin experiencia en Kubernetes ni en móvil. Inglés B2.&rdquo;
          </p>
          <p className="mt-1 font-medium">Qué no poner</p>
          <p>
            Documentos, direcciones, teléfonos, contraseñas ni datos de terceros. El texto se envía
            al modelo que evalúa las ofertas.
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
          >
            Guardar y continuar
          </button>
        </div>
      </form>
      <div className="mt-4 border-t border-zinc-200 pt-4">
        <DeleteAccountForm error={error === "confirmacion"} returnTo="/onboarding" />
      </div>
    </section>
  );
}
