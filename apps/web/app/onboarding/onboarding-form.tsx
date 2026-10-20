"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { unstable_rethrow } from "next/navigation";
import { countChars, TextareaWithCounter } from "@/components/char-counter";
import { RolePicker, type RolePickerGroup } from "@/components/role-picker";
import { saveOnboardingAction } from "./actions";

const input =
  "rounded-md border border-zinc-300 px-3 py-2 text-base aria-[invalid=true]:border-red-700";
const choice = "flex min-h-11 items-center gap-2";

type FormError = { field: string; reason?: "min" | "max"; over?: number };

/** Campo con error y su texto, para que cada `FieldError` decida si le toca. */
const ErrorContext = createContext<{ field: string; text: string } | null>(null);

function FieldError({ name }: { name: string }) {
  const current = useContext(ErrorContext);
  if (current?.field !== name) return null;
  return (
    <p id={`${name}-error`} className="text-sm font-medium text-red-800">
      {current.text}
    </p>
  );
}

/**
 * Paso 1 del onboarding. Los puestos y el resto de los datos nunca se pierden ante un error: el
 * formulario no se recarga ni se resetea, el servidor devuelve el campo con problema y acá se
 * muestra junto a él.
 */
export function OnboardingForm({
  roleGroups,
  selectedRoles,
  rolesLimit,
  defaultRolesLimit,
  countries,
  otherCountry,
  cefrLevels,
  minSummary,
  maxSummary,
}: {
  roleGroups: RolePickerGroup[];
  selectedRoles: readonly string[];
  rolesLimit: number;
  defaultRolesLimit: number;
  countries: readonly { code: string; label: string }[];
  otherCountry: string;
  cefrLevels: readonly string[];
  minSummary: number;
  maxSummary: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();

  const messages: Record<string, string> = {
    targetRoles: `Elegí al menos un puesto (hasta ${rolesLimit}).`,
    country: "Elegí tu país.",
    countryOther: "Escribí el código de país de 2 letras (por ejemplo PT).",
    city: "La ciudad es demasiado larga.",
    remoteOnly: "Elegí si buscás solo trabajo remoto.",
    workAuthOther: "El campo de otras autorizaciones es demasiado largo.",
    englishCefr: "Elegí tu nivel de inglés.",
    yearsTotal: "Los años de experiencia tienen que ser un número entre 0 y 60.",
    salaryFloorUsd: "El piso salarial tiene que ser un número entero en USD (o dejalo vacío).",
    maxWeeklyHours: "Las horas máximas tienen que ser un entero entre 1 y 80 (o dejalo vacío).",
    perfil: "No se encontró tu perfil. Escribile a quien te invitó.",
    _error: "No se pudo guardar. Probá de nuevo; lo que cargaste sigue acá.",
  };
  function messageOf(e: FormError): string {
    if (e.field === "summary") {
      return e.reason === "max"
        ? `El resumen puede tener hasta ${maxSummary} caracteres: te pasaste por ${e.over ?? 1}. Recortalo y volvé a guardar.`
        : `El resumen necesita al menos ${minSummary} caracteres.`;
    }
    return messages[e.field] ?? "Revisá los datos del formulario.";
  }

  // El foco va al campo con error (a la primera casilla en los puestos, al aviso si no hay campo)
  useEffect(() => {
    if (!error) return;
    const form = formRef.current;
    let target: Element | null = null;
    if (form) {
      if (error.field === "targetRoles") {
        target = form.querySelector('input[name="targetRoles"]');
      } else {
        const named = form.elements.namedItem(error.field);
        target = named instanceof RadioNodeList ? (named[0] as Element) : (named as Element | null);
      }
    }
    const el = target instanceof HTMLElement ? target : alertRef.current;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center" });
  }, [error]);

  function fieldProps(name: string, extraDescribedBy?: string) {
    const bad = error?.field === name;
    const ids = [extraDescribedBy, bad ? `${name}-error` : undefined].filter(Boolean).join(" ");
    return {
      "aria-invalid": bad ? (true as const) : undefined,
      "aria-describedby": ids || undefined,
    };
  }

  // onSubmit con preventDefault: <form action> resetea el formulario al terminar la action (React 19)
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    // Sin enviar si algún texto largo se pasó: mismo error que daría el servidor
    for (const el of form.querySelectorAll<HTMLTextAreaElement>("textarea[data-max]")) {
      const over = countChars(el.value) - Number(el.dataset.max);
      if (over > 0) {
        setError({ field: el.name, reason: "max", over });
        return;
      }
    }
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        // Si guarda, la acción redirige y no vuelve; si vuelve, es un error
        const result = await saveOnboardingAction(data);
        const summary = form.elements.namedItem("summary");
        const over =
          result.field === "summary" && summary instanceof HTMLTextAreaElement
            ? countChars(summary.value) - maxSummary
            : 0;
        setError({
          field: result.field,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(over > 0 ? { over } : {}),
        });
      } catch (e) {
        // El redirect y otros errores de Next siguen su camino; el resto no desmonta el form
        unstable_rethrow(e);
        setError({ field: "_error" });
      }
    });
  }

  return (
    <ErrorContext.Provider value={error ? { field: error.field, text: messageOf(error) } : null}>
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
        {error ? (
          <p
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {messageOf(error)}
          </p>
        ) : null}
        <fieldset
          className="flex flex-col gap-2 text-sm"
          aria-describedby={error?.field === "targetRoles" ? "targetRoles-error" : "roles-help"}
        >
          <legend className="mb-1">¿Qué puestos buscás?</legend>
          <p id="roles-help" className="text-xs text-zinc-600">
            Elegí hasta {rolesLimit}. Te mostramos primero las ofertas de esos puestos. Además de
            tecnología, hay carreras digitales: marketing, producto, recruiting IT, customer success
            y ciberseguridad.
          </p>
          <RolePicker
            name="targetRoles"
            selected={selectedRoles}
            limit={rolesLimit}
            defaultLimit={defaultRolesLimit}
            groups={roleGroups}
          />
          <FieldError name="targetRoles" />
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            País de residencia *
            <select
              name="country"
              required
              defaultValue=""
              {...fieldProps("country")}
              className={input}
            >
              <option value="" disabled>
                Elegí uno
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
              <option value={otherCountry}>Otro (escribí el código abajo)</option>
            </select>
            <FieldError name="country" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Otro país: código de 2 letras
            <input
              name="countryOther"
              maxLength={2}
              placeholder="PT"
              autoComplete="off"
              {...fieldProps("countryOther")}
              className={input}
            />
            <FieldError name="countryOther" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ciudad (opcional)
            <input name="city" maxLength={100} {...fieldProps("city")} className={input} />
            <FieldError name="city" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Inglés (nivel CEFR) *
            <select
              name="englishCefr"
              required
              defaultValue=""
              {...fieldProps("englishCefr", "cefr-help")}
              className={input}
            >
              <option value="" disabled>
                Elegí uno
              </option>
              {cefrLevels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <FieldError name="englishCefr" />
          </label>
          <p id="cefr-help" className="text-xs text-zinc-600 sm:col-span-2">
            Es la escala de inglés que usan muchos avisos. Si dudás entre dos, elegí el más bajo.
          </p>
          <details className="rounded-md border border-zinc-200 p-3 text-sm sm:col-span-2">
            <summary className="cursor-pointer font-medium">¿Qué es CEFR?</summary>
            <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-zinc-700">
              <li>
                <span className="font-medium">A1–A2 · básico:</span> entendés frases y textos
                cortos.
              </li>
              <li>
                <span className="font-medium">B1 · intermedio:</span> leés documentación y escribís
                mails simples; seguir una reunión en inglés te cuesta.
              </li>
              <li>
                <span className="font-medium">B2 · intermedio alto:</span> participás en reuniones y
                entrevistas con algunos errores.
              </li>
              <li>
                <span className="font-medium">C1 · avanzado:</span> trabajás todo el día en inglés
                sin problema.
              </li>
              <li>
                <span className="font-medium">C2 · casi nativo.</span>
              </li>
            </ul>
          </details>
          <label className="flex flex-col gap-1 text-sm">
            Años de experiencia *
            <input
              name="yearsTotal"
              type="number"
              min={0}
              max={60}
              step="0.5"
              required
              {...fieldProps("yearsTotal")}
              className={input}
            />
            <FieldError name="yearsTotal" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Piso salarial mensual en USD (opcional)
            <input
              name="salaryFloorUsd"
              type="number"
              min={0}
              step={1}
              {...fieldProps("salaryFloorUsd")}
              className={input}
            />
            <FieldError name="salaryFloorUsd" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Horas máximas por semana (opcional)
            <input
              name="maxWeeklyHours"
              type="number"
              min={1}
              max={80}
              step={1}
              {...fieldProps("maxWeeklyHours")}
              className={input}
            />
            <FieldError name="maxWeeklyHours" />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">¿Buscás solo trabajo remoto? *</legend>
          <label className={choice}>
            <input
              name="remoteOnly"
              type="radio"
              value="si"
              required
              {...fieldProps("remoteOnly")}
            />{" "}
            Sí, solo remoto
          </label>
          <label className={choice}>
            <input name="remoteOnly" type="radio" value="no" {...fieldProps("remoteOnly")} /> No,
            también híbrido o presencial
          </label>
          <FieldError name="remoteOnly" />
          <p className="text-xs text-zinc-600">
            Si elegís «Sí», las ofertas híbridas o presenciales se descartan solas. Si elegís «No»,
            se muestran con ese riesgo marcado.
          </p>
        </fieldset>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">Autorización de trabajo</legend>
          <label className={choice}>
            <input name="workAuthUs" type="checkbox" /> Puedo trabajar en EE.UU. sin visa
            patrocinada
          </label>
          <label className={choice}>
            <input name="workAuthEu" type="checkbox" /> Puedo trabajar en la Unión Europea sin visa
            patrocinada
          </label>
          <label className="flex flex-col gap-1">
            Otros países donde puedo trabajar (opcional, separados por coma)
            <input
              name="workAuthOther"
              maxLength={200}
              placeholder="CA, MX"
              {...fieldProps("workAuthOther")}
              className={input}
            />
            <FieldError name="workAuthOther" />
          </label>
        </fieldset>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="summary">Resumen de tu perfil * (mínimo {minSummary} caracteres)</label>
          <TextareaWithCounter
            name="summary"
            min={minSummary}
            max={maxSummary}
            rows={9}
            required
            invalid={error?.field === "summary"}
            describedBy={error?.field === "summary" ? "summary-error" : undefined}
            className={input}
          />
          <FieldError name="summary" />
        </div>
        <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <p className="font-medium">Qué poner</p>
          <p>
            Tu puesto y años de experiencia; qué dominás y ya hiciste en trabajos reales, qué usaste
            pero no es lo tuyo, y qué casi no conocés. Ser honesto con lo que no sabés evita que te
            recomienden avisos que no podés cubrir. Ejemplo inventado: &ldquo;Analista con 5 años en
            equipos de producto; dominio de investigación con usuarios y reportes en producción;
            nivel intermedio en herramientas de datos; sin experiencia en gestión de equipos. Inglés
            B2.&rdquo;
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
            disabled={pending}
            className="min-h-11 w-full rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-60 sm:w-auto"
          >
            {pending ? "Guardando…" : "Guardar y continuar"}
          </button>
        </div>
      </form>
    </ErrorContext.Provider>
  );
}
