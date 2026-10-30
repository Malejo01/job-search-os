"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { unstable_rethrow } from "next/navigation";
import { CountrySearch } from "@/app/onboarding/country-search";
import { CefrHelp } from "@/components/cefr-help";
import { countChars, TextareaWithCounter } from "@/components/char-counter";
import type { ProfileFormValues } from "@/lib/onboarding";

const MODALITY_OPTIONS = [
  { value: "remoto", label: "Remoto" },
  { value: "hibrido", label: "Híbrido" },
  { value: "presencial", label: "Presencial" },
] as const;

const input =
  "min-h-11 min-w-0 rounded-control border border-line-strong px-3 py-2 text-base aria-[invalid=true]:border-danger-strong";
// Resumen: alto fijo de varias líneas (no crece al escribir, el usuario puede estirarlo) y sin el min-h-11 de `input`
const summaryInput =
  "min-h-56 min-w-0 resize-y rounded-control border border-line-strong px-3 py-2 text-base leading-6 aria-[invalid=true]:border-danger-strong";
const choice = "flex min-h-11 items-center gap-2";

/** Debajo de este número de ofertas en español, «Solo en español» deja casi sin avisos (A-2). */
const FEW_SPANISH_JOBS = 10;

/**
 * Ejemplos de resumen (A-9), uno por grupo de carrera. Todo inventado; muestran qué poner
 * (experiencia concreta, herramientas, logros con números, y lo que no se domina) sin inflar.
 */
const SUMMARY_EXAMPLES = [
  {
    id: "tecnologia",
    label: "Tecnología",
    roles: [
      "frontend",
      "backend",
      "fullstack",
      "qa",
      "data_analyst",
      "soporte_it",
      "ai_engineer",
      "ux_ui",
      "data_engineer",
      "solutions_engineer",
      "ciberseguridad",
    ],
    text: "Desarrolladora backend con 4 años en una empresa de logística: APIs en Node.js y PostgreSQL, bajé el tiempo de respuesta de un endpoint de 2 s a 400 ms. Uso Docker a diario; tuve contacto con AWS pero solo en pruebas; no tengo experiencia en Kubernetes. Inglés B2.",
  },
  {
    id: "producto",
    label: "Producto y carreras digitales",
    roles: [
      "product_manager",
      "product_owner",
      "project_manager",
      "product_marketing",
      "marketing_digital",
      "rrhh_it",
      "customer_success",
    ],
    text: "Product owner con 3 años en una app de turnos médicos: armé y prioricé el backlog de un equipo de 6 personas, escribí historias de usuario y medí adopción con Mixpanel (la reserva online subió de 18 % a 31 %). Domino Jira y entrevistas con usuarios; conozco SQL básico; nunca manejé un presupuesto. Inglés B1.",
  },
  {
    id: "ventas",
    label: "Ventas y atención",
    roles: ["ventas_b2b", "atencion_cliente"],
    text: "Vendedora B2B con 6 años en una empresa de software para comercios: hacía prospección en frío y cerré 30 cuentas nuevas en un año, con una cuota cumplida 8 de cada 12 meses. Uso un CRM a diario; di demos pero no negocié contratos grandes. Inglés A2.",
  },
] as const;

export type ProfileFormError = {
  field: string;
  reason?: "min" | "max" | "injection";
  over?: number;
};

/** Lo que devuelve la acción: en el onboarding, si guarda, redirige y no vuelve. */
export type ProfileActionResult =
  { ok: true } | { ok: false; field: string; reason?: "min" | "max" | "injection" };

/** Campo con error y su texto, para que cada `FieldError` decida si le toca. */
const ErrorContext = createContext<{ error: ProfileFormError | null; text: string } | null>(null);

/** El error actual del formulario (para los bloques que se pasan como hijos, como los puestos). */
export function useProfileError(): ProfileFormError | null {
  return useContext(ErrorContext)?.error ?? null;
}

export function FieldError({ name }: { name: string }) {
  const current = useContext(ErrorContext);
  if (current?.error?.field !== name) return null;
  return (
    <p id={`${name}-error`} className="text-sm font-medium text-danger">
      {current.text}
    </p>
  );
}

/**
 * Campos del perfil que comparten el paso 1 del onboarding y «Tu perfil» en Ajustes. Los datos
 * nunca se pierden ante un error: el formulario no se recarga ni se resetea, el servidor devuelve
 * el campo con problema y acá se muestra junto a él. Los `children` van arriba de los campos (el
 * onboarding pone ahí los puestos). Con `initial` los campos arrancan con lo guardado.
 */
export function ProfileForm({
  action,
  initial,
  children,
  rolesLimit,
  countries,
  cefrLevels,
  countryCodes,
  minSummary,
  maxSummary,
  showLimits,
  submitLabel,
  savedMessage,
  rolesNotice,
  selectedRoles,
  spanishCounts,
  roleLabels,
}: {
  /** Puestos elegidos al abrir el formulario; después se leen de las casillas `targetRoles`. */
  selectedRoles?: readonly string[] | undefined;
  /** Ofertas en español por puesto (30 días), para el aviso de «Solo en español». */
  spanishCounts?: Partial<Record<string, number>> | undefined;
  /** Etiqueta de cada puesto, para nombrarlo en el aviso. */
  roleLabels?: Partial<Record<string, string>> | undefined;
  /** Texto del error de puestos cuando el formulario no tiene ese campo (Ajustes). */
  rolesNotice?: ReactNode;
  action: (formData: FormData) => Promise<ProfileActionResult>;
  initial?: ProfileFormValues | undefined;
  children?: ReactNode;
  /** Tope de puestos, solo para el texto del error del onboarding. */
  rolesLimit?: number;
  /** Países de LATAM: van primero en el buscador de residencia. */
  countries: readonly { code: string; label: string }[];
  cefrLevels: readonly string[];
  /** Códigos ISO-2 para el buscador de autorización de trabajo (la lista vive en el pipeline). */
  countryCodes: readonly string[];
  minSummary: number;
  maxSummary: number;
  /** Piso salarial y horas máximas: se piden en el onboarding; en Ajustes viven en los criterios. */
  showLimits: boolean;
  submitLabel: string;
  /** Si la acción vuelve con `ok: true`, se muestra este texto en vez de navegar. */
  savedMessage?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState<ProfileFormError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [modalities, setModalities] = useState<string[]>(initial?.acceptedModalities ?? ["remoto"]);
  const [hasCity, setHasCity] = useState((initial?.city ?? "").trim() !== "");
  const [jobLanguage, setJobLanguage] = useState<string>(initial?.jobLanguage ?? "both");
  const [chosenRoles, setChosenRoles] = useState<readonly string[]>(selectedRoles ?? []);
  // Aviso no bloqueante (A-2): «Solo en español» con una carrera que casi no tiene ofertas así
  const fewInSpanish =
    jobLanguage === "es"
      ? chosenRoles.flatMap((key) => {
          const n = spanishCounts?.[key];
          return n !== undefined && n < FEW_SPANISH_JOBS ? [{ key, n }] : [];
        })
      : [];
  // Ejemplos de resumen (A-9): primero el del grupo de la carrera elegida
  const examples = SUMMARY_EXAMPLES.slice().sort(
    (a, b) =>
      Number(b.roles.some((r) => chosenRoles.includes(r))) -
      Number(a.roles.some((r) => chosenRoles.includes(r))),
  );
  const hasChosenGroup = examples[0]!.roles.some((r) => chosenRoles.includes(r));
  // Aviso no bloqueante: sin ciudad no se puede comparar con la del aviso
  const needsCity =
    !hasCity && (modalities.includes("hibrido") || modalities.includes("presencial"));

  const messages: Record<string, string> = {
    targetRoles: `Elegí al menos un puesto${rolesLimit ? ` (hasta ${rolesLimit})` : ""}.`,
    country: "Elegí tu país.",
    city: "La ciudad es demasiado larga.",
    acceptedModalities: "Marcá al menos una modalidad.",
    jobLanguage: "Elegí en qué idioma aceptás ofertas.",
    workAuthOther:
      "Uno de los países de autorización de trabajo no es válido. Quitalo y volvé a elegir.",
    englishCefr: "Elegí tu nivel de inglés.",
    yearsTotal: "Los años de experiencia tienen que ser un número entre 0 y 60.",
    salaryFloorUsd: "El piso salarial tiene que ser un número entero en USD (o dejalo vacío).",
    maxWeeklyHours: "Las horas máximas tienen que ser un entero entre 1 y 80 (o dejalo vacío).",
    perfil: "No se encontró tu perfil. Escribile a quien te invitó.",
    _error: "No se pudo guardar. Probá de nuevo; lo que cargaste sigue acá.",
  };
  function messageOf(e: ProfileFormError): string {
    if (e.field === "summary") {
      if (e.reason === "injection") {
        return 'Tu resumen tiene frases que parecen instrucciones para la IA (por ejemplo "ignorá lo anterior"). Reescribilas con tus palabras.';
      }
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
        // Los buscadores de país no tienen `name` (solo mandan hidden): se marcan con data-field
        if (!target || (target instanceof HTMLInputElement && target.type === "hidden")) {
          target = form.querySelector(`[data-field="${error.field}"]`);
        }
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
    setSaved(false);
    // Sin enviar si algún texto largo se pasó: mismo error que daría el servidor
    for (const el of form.querySelectorAll<HTMLTextAreaElement>("textarea[data-max]")) {
      const over = countChars(el.value) - Number(el.dataset.max);
      if (over > 0) {
        setError({ field: el.name, reason: "max", over });
        return;
      }
    }
    // Resumen corto: sin `minLength` nativo, el mensaje es el propio y el foco va al campo
    const summaryEl = form.elements.namedItem("summary");
    if (summaryEl instanceof HTMLTextAreaElement && countChars(summaryEl.value) < minSummary) {
      setError({ field: "summary", reason: "min" });
      return;
    }
    // Sin modalidad marcada no se envía: mismo error que daría el servidor, con foco en Remoto
    if (modalities.length === 0) {
      setError({ field: "acceptedModalities" });
      return;
    }
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        // En el onboarding, si guarda, la acción redirige y no vuelve; si vuelve, es un error
        const result = await action(data);
        if (result.ok) {
          setSaved(true);
          return;
        }
        // El servidor llama `profileSummary` al resumen; el campo del formulario es `summary`
        const field = result.field === "profileSummary" ? "summary" : result.field;
        const summary = form.elements.namedItem("summary");
        const over =
          field === "summary" &&
          result.reason !== "injection" &&
          summary instanceof HTMLTextAreaElement
            ? countChars(summary.value) - maxSummary
            : 0;
        setError({
          field,
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
    <ErrorContext.Provider value={{ error, text: error ? messageOf(error) : "" }}>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        onChange={(e) => {
          // Los puestos viven en un hijo (RolePicker): se leen de las casillas marcadas
          if (e.target instanceof HTMLInputElement && e.target.name === "targetRoles") {
            setChosenRoles(
              Array.from(
                e.currentTarget.querySelectorAll<HTMLInputElement>(
                  'input[name="targetRoles"]:checked',
                ),
              ).map((i) => i.value),
            );
          }
        }}
        className="flex flex-col gap-3"
      >
        {error ? (
          <p
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error.field === "targetRoles" && rolesNotice ? rolesNotice : messageOf(error)}
          </p>
        ) : null}
        {/* `data-tour`: anclas de la guía del paso 1 (ronda 92); en Ajustes no hay guía y no cambian nada */}
        {children ? <div data-tour="perfil:puestos">{children}</div> : null}
        <div data-tour="perfil:pais-ingles" className="grid items-start gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <CountrySearch
              name="country"
              codes={countryCodes}
              label="País de residencia *"
              placeholder="Escribí tu país"
              max={1}
              priority={countries.map((c) => c.code)}
              initial={initial?.country ? [initial.country] : []}
              invalid={error?.field === "country"}
              describedBy={error?.field === "country" ? "country-error" : undefined}
            />
            <FieldError name="country" />
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            Ciudad (opcional)
            <input
              name="city"
              maxLength={100}
              defaultValue={initial?.city ?? ""}
              onChange={(e) => setHasCity(e.target.value.trim() !== "")}
              {...fieldProps("city")}
              className={input}
            />
            <FieldError name="city" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            Tu nivel de inglés *
            <select
              name="englishCefr"
              required
              defaultValue={initial?.englishCefr ?? ""}
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
          <p id="cefr-help" className="text-xs text-fg-subtle sm:col-span-2">
            Se mide con la escala CEFR, que usan muchos avisos. Si dudás entre dos niveles, elegí el
            más bajo.
          </p>
          <CefrHelp className="sm:col-span-2" />
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            Años de experiencia *
            <input
              name="yearsTotal"
              type="number"
              min={0}
              max={60}
              step="0.5"
              required
              defaultValue={initial?.yearsTotal ?? ""}
              {...fieldProps("yearsTotal")}
              className={input}
            />
            <FieldError name="yearsTotal" />
          </label>
          {showLimits ? (
            <>
              <label className="flex min-w-0 flex-col gap-1 text-sm">
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
              <label className="flex min-w-0 flex-col gap-1 text-sm">
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
            </>
          ) : null}
        </div>
        <fieldset
          data-tour="perfil:modalidad"
          className="flex min-w-0 flex-col gap-2 text-sm"
          aria-describedby={
            error?.field === "acceptedModalities" ? "acceptedModalities-error" : "modalities-help"
          }
        >
          <legend className="mb-1">¿Qué modalidades aceptás? *</legend>
          {MODALITY_OPTIONS.map((m) => (
            <label key={m.value} className={choice}>
              <input
                name="acceptedModalities"
                type="checkbox"
                className="h-5 w-5"
                value={m.value}
                checked={modalities.includes(m.value)}
                onChange={(e) =>
                  setModalities((prev) =>
                    e.target.checked ? [...prev, m.value] : prev.filter((v) => v !== m.value),
                  )
                }
                {...fieldProps("acceptedModalities")}
              />{" "}
              {m.label}
            </label>
          ))}
          <FieldError name="acceptedModalities" />
          <p id="modalities-help" className="text-xs text-fg-subtle">
            Si marcás Híbrido o Presencial, usamos la ciudad de tu perfil para avisarte si la oferta
            es en otro lado
          </p>
          {/* Siempre montado: solo cambia el texto, así el lector de pantalla lo anuncia */}
          <p role="status" className="min-h-4 text-xs font-medium text-warning">
            {needsCity
              ? "Sin ciudad no podemos avisarte si la oferta es en otro lado. Cargala arriba."
              : ""}
          </p>
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
          <legend className="mb-1">¿En qué idioma aceptás ofertas? *</legend>
          <label className={choice}>
            <input
              name="jobLanguage"
              type="radio"
              value="es"
              required
              defaultChecked={initial?.jobLanguage === "es"}
              onChange={() => setJobLanguage("es")}
              {...fieldProps("jobLanguage")}
            />{" "}
            Solo en español
          </label>
          <label className={choice}>
            <input
              name="jobLanguage"
              type="radio"
              value="en"
              defaultChecked={initial?.jobLanguage === "en"}
              onChange={() => setJobLanguage("en")}
              {...fieldProps("jobLanguage")}
            />{" "}
            Solo en inglés
          </label>
          <label className={choice}>
            <input
              name="jobLanguage"
              type="radio"
              value="both"
              defaultChecked={(initial?.jobLanguage ?? "both") === "both"}
              onChange={() => setJobLanguage("both")}
              {...fieldProps("jobLanguage")}
            />{" "}
            En los dos
          </label>
          <FieldError name="jobLanguage" />
          {/* Siempre montado: un lector de pantalla no anuncia un aviso que aparece ya armado */}
          <div aria-live="polite" data-testid="few-spanish-notice" className="min-w-0">
            {fewInSpanish.map(({ key, n }) => (
              <p
                key={key}
                data-testid={`few-spanish-${key}`}
                className="mb-1 break-words rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
              >
                Para {roleLabels?.[key] ?? key} casi no hay ofertas en español ({n}). Si aceptás
                ofertas en inglés vas a ver muchas más.
              </p>
            ))}
          </div>
        </fieldset>
        <fieldset data-tour="perfil:autorizacion" className="flex min-w-0 flex-col gap-2 text-sm">
          <legend className="mb-1">Autorización de trabajo</legend>
          <p className="text-xs text-fg-subtle">
            Completalo solo si tenés ciudadanía, residencia o visa de trabajo en otro país. Si no,
            dejalo vacío.
          </p>
          <label className={choice}>
            <input
              name="workAuthUs"
              type="checkbox"
              className="h-5 w-5"
              defaultChecked={initial?.workAuthUs ?? false}
            />{" "}
            Puedo trabajar en EE.UU. sin que la empresa me tramite la visa
          </label>
          <label className={choice}>
            <input
              name="workAuthEu"
              type="checkbox"
              className="h-5 w-5"
              defaultChecked={initial?.workAuthEu ?? false}
            />{" "}
            Puedo trabajar en la Unión Europea sin que la empresa me tramite la visa
          </label>
          <p className="mt-1">Otros países donde puedo trabajar (opcional)</p>
          <CountrySearch
            name="workAuthOther"
            codes={countryCodes}
            initial={initial?.workAuthOther ?? []}
            invalid={error?.field === "workAuthOther"}
            describedBy={error?.field === "workAuthOther" ? "workAuthOther-error" : undefined}
          />
          <FieldError name="workAuthOther" />
        </fieldset>
        <div
          id="summary-help"
          className="rounded-control bg-surface-subtle px-3 py-2 text-xs text-fg-subtle"
        >
          <p className="font-medium">Qué poner</p>
          <p>
            Tu puesto y años de experiencia; qué dominás y ya hiciste en trabajos reales, qué usaste
            pero no es lo tuyo, y qué casi no conocés. Ser honesto con lo que no sabés evita que te
            recomienden avisos que no podés cubrir. Incluí experiencia concreta, herramientas y
            logros con números reales. No los infles: es un resumen, no un currículum.
          </p>
          {hasChosenGroup ? (
            <>
              <p className="mt-1 font-medium">Ejemplo inventado para tu carrera</p>
              {examples
                .filter((ex) => ex.roles.some((r) => chosenRoles.includes(r)))
                .map((ex) => (
                  <p key={ex.id} data-testid={`summary-example-${ex.id}`}>
                    <span className="font-medium">{ex.label}:</span> &ldquo;{ex.text}&rdquo;
                  </p>
                ))}
            </>
          ) : null}
          <details className="mt-1" data-testid="summary-examples-more">
            <summary className="min-h-11 cursor-pointer py-2 font-medium">
              {hasChosenGroup ? "Ver ejemplos de otros grupos" : "Ver ejemplos inventados"}
            </summary>
            {examples
              .filter((ex) => !ex.roles.some((r) => chosenRoles.includes(r)))
              .map((ex) => (
                <p key={ex.id} className="mb-1" data-testid={`summary-example-${ex.id}`}>
                  <span className="font-medium">{ex.label}:</span> &ldquo;{ex.text}&rdquo;
                </p>
              ))}
          </details>
          <p className="mt-1 font-medium">Qué no poner</p>
          <p>
            Documentos, direcciones, teléfonos, contraseñas ni datos de terceros. El texto se envía
            al modelo que evalúa las ofertas.
          </p>
        </div>
        <div data-tour="perfil:resumen" className="flex min-w-0 flex-col gap-1 text-sm">
          <label htmlFor="summary">Resumen de tu perfil * (mínimo {minSummary} caracteres)</label>
          <TextareaWithCounter
            name="summary"
            max={maxSummary}
            softMin={minSummary}
            rows={9}
            defaultValue={initial?.summary ?? ""}
            invalid={error?.field === "summary"}
            describedBy={error?.field === "summary" ? "summary-error summary-help" : "summary-help"}
            className={summaryInput}
          />
          <FieldError name="summary" />
        </div>
        {/* Siempre montado: un lector de pantalla no anuncia un aviso que aparece ya armado */}
        <p role="status" className="min-h-5 text-sm font-medium text-success">
          {saved && savedMessage ? savedMessage : ""}
        </p>
        <div className="flex justify-end">
          <button
            type="submit"
            data-tour="perfil:guardar"
            disabled={pending}
            className="min-h-11 w-full rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 sm:w-auto"
          >
            {pending ? "Guardando…" : submitLabel}
          </button>
        </div>
      </form>
    </ErrorContext.Provider>
  );
}
