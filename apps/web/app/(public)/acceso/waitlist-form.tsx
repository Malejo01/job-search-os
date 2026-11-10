"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
// R-1: import directo (el barril de `@/components/ui` arrastra el de pipeline al navegador)
import { buttonClasses } from "@/components/ui/button";
import { submitWaitlist, trackAcceso, type WaitlistState } from "./actions";
import { ShareButton } from "./share-button";

const INITIAL: WaitlistState = { status: "idle" };
// Campo y etiqueta (C10-5, `.field` y `.fl` del tablero): R-1, sin el barril de `@/components/ui`
const field =
  "min-h-11 w-full rounded-control border-x-2 border-t-2 border-b-4 border-line-strong bg-surface px-4 py-[13px] text-base leading-[1.2] font-semibold text-fg placeholder:text-fg-subtle focus-visible:border-focus aria-invalid:border-danger-strong sm:text-[15px]";
const label = "flex flex-col gap-1.5 text-[13px] font-extrabold text-fg";
// Chip de carrera (`.chip` y `.chipon`): el `label` mide 44 px (el área táctil) y adentro va la
// píldora de 38 px de la referencia. El radio, transparente, cubre todo el `label`: se toca donde
// se toque. El elegido va en lima con borde índigo
const chipBox = "relative min-h-11 cursor-pointer items-center py-[3px]";
const chipPill =
  "inline-flex items-center rounded-pill border-x-2 border-t-2 border-b-4 border-line-strong bg-surface px-3.5 py-2 text-[13px] leading-[1.2] font-bold whitespace-nowrap text-fg group-hover/chip:bg-surface-muted group-has-[:checked]/chip:border-brand-contrast group-has-[:checked]/chip:bg-brand group-has-[:checked]/chip:text-brand-contrast group-has-[:focus-visible]/chip:outline group-has-[:focus-visible]/chip:outline-2 group-has-[:focus-visible]/chip:outline-offset-2 group-has-[:focus-visible]/chip:outline-focus";
// En el celular se ven tres y «+3» (acceso-cel.png)
const FIRST_CHIPS = 3;

export type RoleOption = { key: string; label: string };
/** Chip de carrera: `key` lo identifica y `role` es la carrera que se guarda (dos chips pueden compartirla). */
export type CareerChip = RoleOption & { role: string };
export type RoleOptionGroup = { label: string; roles: RoleOption[] };

type FormProps = {
  groups: RoleOptionGroup[];
  /** Las ocho carreras de la beta, como chips, con el nombre corto. */
  betaCareers: CareerChip[];
  contact: { email: string; href: string } | null;
  /** Embudo de /acceso (C8-2): la página lo prende con `ACCESO_FUNNEL_ENABLED`. */
  funnel?: boolean;
  /** Nombre de la marca para compartir: lo pasa la página (servidor) para no traer pipeline al cliente. */
  brandName: string;
};

type FieldsProps = FormProps & {
  initialHeardFrom: string;
  /** `?origen=` tal cual: el servidor lo normaliza a una lista cerrada antes de contarlo. */
  origen?: string | null;
};

/** Una visita por pestaña y origen (recargar no suma). Sin almacenamiento disponible, cuenta igual. */
function firstVisitInTab(origen: string | null): boolean {
  const key = `jso-acceso-visita:${origen ?? ""}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // modo privado o almacenamiento bloqueado
  }
  return true;
}

/**
 * Formulario "Pedir acceso" con el origen del QR (`?origen=voces-jovenes`). Lee la URL en el
 * cliente; mientras tanto la página muestra el mismo formulario sin el origen
 * (`WaitlistFormFields` como fallback del Suspense), así no hay salto de layout al hidratar (C7-15).
 */
export function WaitlistForm(props: FormProps) {
  const searchParams = useSearchParams();
  const origen = searchParams.get("origen");
  const { funnel } = props;
  // Solo el formulario real cuenta la visita (no el fallback del Suspense)
  useEffect(() => {
    if (funnel && firstVisitInTab(origen)) void trackAcceso("visita", origen).catch(() => {});
  }, [funnel, origen]);
  return (
    <WaitlistFormFields
      {...props}
      origen={origen}
      initialHeardFrom={origen === "voces-jovenes" ? "Voces Jóvenes" : ""}
    />
  );
}

/** El formulario en sí. Las carreras las arma la página (servidor) para no traer la base al cliente. */
export function WaitlistFormFields({
  groups,
  betaCareers,
  initialHeardFrom,
  funnel = false,
  origen = null,
  brandName,
}: FieldsProps) {
  const [state, action, pending] = useActionState(submitWaitlist, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);
  const [allCareers, setAllCareers] = useState(false);
  // «Otra carrera» (C10): el selector con las demás carreras y «¿Cómo te enteraste?»
  const [other, setOther] = useState(false);
  // Una sola carrera: la del chip o la de «Otra carrera», la última que se tocó. Va en un campo
  // oculto (`role`), así nunca viajan dos valores
  // `choice` es el chip elegido o la carrera del selector; `role` es la carrera que se guarda
  const [choice, setChoice] = useState("");
  const role = betaCareers.find((c) => c.key === choice)?.role ?? choice;
  const onCareer = (value: string) => {
    setChoice(value);
    const saved = betaCareers.find((c) => c.key === value)?.role ?? value;
    if (funnel) void trackAcceso("carrera", origen, saved).catch(() => {});
  };
  // Embudo (C8-2): el primer campo tocado y cada carrera elegida. Nunca lo escrito.
  const onFirstFocus = () => {
    if (!funnel || started.current) return;
    started.current = true;
    void trackAcceso("empezado", origen).catch(() => {});
  };
  // Mientras se envía no se muestran los errores del intento anterior
  const showError = state.status === "error" && !pending;
  const errors = showError && state.fieldErrors ? state.fieldErrors : {};

  // Con errores de campo, el foco va al primer campo inválido
  useEffect(() => {
    if (state.status !== "error" || !state.fieldErrors) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  if (state.status === "done") {
    // Confirmación (C8-3): qué pasa ahora, sin prometer lugar, y para pasárselo a otra persona
    return (
      <div className="flex flex-col gap-4" data-testid="acceso-confirmacion">
        <p
          role="status"
          className="rounded-card bg-success-soft px-4 py-4 text-base font-semibold text-success"
        >
          {state.message}
        </p>
        <section
          aria-labelledby="acceso-que-sigue"
          className="flex flex-col gap-2 rounded-card bg-surface p-4"
        >
          <h2 id="acceso-que-sigue" className="text-base font-bold">
            Qué sigue
          </h2>
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-fg-muted">
            <li>
              Revisamos los pedidos y armamos el grupo de la beta, con lugar para cada carrera.
            </li>
            <li>
              Si hay lugar para vos, te escribimos con el link para crear tu cuenta. Si es por
              email, mirá también en spam.
            </li>
            <li>
              Mientras tanto, mirá{" "}
              <Link
                href="/demo/contaduria"
                className="font-semibold text-link underline underline-offset-2 hover:text-link-hover"
              >
                cómo funciona con un ejemplo
              </Link>
              .
            </li>
          </ol>
        </section>
        <ShareButton brandName={brandName} />
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      onFocus={funnel ? onFirstFocus : undefined}
      className="flex flex-col gap-3.5 sm:gap-[18px]"
      noValidate
    >
      {origen ? <input type="hidden" name="origen" value={origen.slice(0, 40)} /> : null}
      <input type="hidden" name="role" value={role} />
      <div className="grid gap-3.5 sm:grid-cols-2 sm:gap-4">
        <label className={label}>
          Tu nombre
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Lucía"
            required
            aria-required="true"
            maxLength={120}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "acceso-name-error" : undefined}
            className={field}
          />
          {errors.name ? (
            <span id="acceso-name-error" className="text-sm font-semibold text-danger">
              {errors.name}
            </span>
          ) : null}
        </label>

        <label className={label}>
          Tu email
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="lucia@gmail.com"
            required
            aria-required="true"
            maxLength={254}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "acceso-email-error" : undefined}
            className={field}
          />
          {errors.email ? (
            <span id="acceso-email-error" className="text-sm font-semibold text-danger">
              {errors.email}
            </span>
          ) : null}
        </label>
      </div>

      {/* Las ocho carreras como chips (radios). Las demás, en «Otra carrera». Las dos escriben la
          misma carrera (`role`) */}
      <fieldset
        className="m-0 flex flex-col gap-1.5 border-0 p-0"
        aria-describedby={errors.role ? "acceso-role-error" : undefined}
      >
        <legend className="mb-1.5 p-0 text-[13px] font-extrabold text-fg">
          ¿Qué estudiaste o estudiás?
        </legend>
        <div className="flex flex-wrap gap-x-1.5 sm:gap-x-2 sm:gap-y-0.5">
          {betaCareers.map((c, i) => (
            <label
              key={c.key}
              className={`group/chip ${chipBox} ${i >= FIRST_CHIPS && !allCareers ? "hidden sm:inline-flex" : "inline-flex"}`}
            >
              <input
                type="radio"
                name="carrera-chip"
                value={c.key}
                checked={choice === c.key}
                onChange={() => onCareer(c.key)}
                aria-invalid={errors.role ? true : undefined}
                className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-pill opacity-0"
              />
              <span className={chipPill}>{c.label}</span>
            </label>
          ))}
          <button
            type="button"
            onClick={() => setOther((v) => !v)}
            aria-expanded={other}
            aria-controls="acceso-otra-carrera"
            className={`group/chip ${chipBox} ${allCareers ? "inline-flex" : "hidden sm:inline-flex"}`}
          >
            <span className={chipPill}>Otra carrera</span>
          </button>
          {!allCareers && betaCareers.length > FIRST_CHIPS ? (
            <button
              type="button"
              onClick={() => setAllCareers(true)}
              aria-label={`Ver ${betaCareers.length - FIRST_CHIPS} más`}
              className={`group/chip ${chipBox} inline-flex sm:hidden`}
            >
              <span className={chipPill}>+{betaCareers.length - FIRST_CHIPS}</span>
            </button>
          ) : null}
        </div>
        {errors.role ? (
          <span id="acceso-role-error" className="text-sm font-semibold text-danger">
            {errors.role}
          </span>
        ) : null}
      </fieldset>

      {/* Las demás carreras y «¿Cómo te enteraste?» (C10): se abren con «Otra carrera». Cerrado
          sigue en el formulario (el origen del QR completa «Voces Jóvenes» igual) */}
      <div id="acceso-otra-carrera" className={other ? "contents" : "hidden"}>
        <div className="flex flex-col gap-3.5 pt-2">
          <label className={label}>
            Carrera
            <select
              value={betaCareers.some((c) => c.key === choice) ? "" : choice}
              onChange={(e) => onCareer(e.target.value)}
              className={field}
            >
              <option value="">Elegí una carrera</option>
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={label}>
            ¿Cómo te enteraste? (opcional)
            <input
              name="heardFrom"
              type="text"
              defaultValue={initialHeardFrom}
              key={initialHeardFrom}
              list="acceso-heard-options"
              maxLength={200}
              aria-invalid={errors.heardFrom ? true : undefined}
              aria-describedby={
                errors.heardFrom ? "acceso-heard-hint acceso-heard-error" : "acceso-heard-hint"
              }
              className={field}
            />
            <datalist id="acceso-heard-options">
              <option value="Voces Jóvenes" />
              <option value="Instagram" />
              <option value="LinkedIn" />
              <option value="Me lo contó alguien" />
            </datalist>
            <span id="acceso-heard-hint" className="text-xs font-medium text-fg-subtle">
              No pongas datos personales.
            </span>
            {errors.heardFrom ? (
              <span id="acceso-heard-error" className="text-sm font-semibold text-danger">
                {errors.heardFrom}
              </span>
            ) : null}
          </label>
        </div>
      </div>

      {/* Honeypot: fuera de pantalla y fuera del orden de tabulación; las personas no lo completan */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          No completar este campo
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="flex flex-col gap-3.5 sm:mt-1 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className={buttonClasses({ size: "lg", className: "w-full sm:w-auto sm:px-8" })}
        >
          {pending ? "Enviando…" : "Anotarme"}
        </button>
        <div className="hidden sm:block">
          <ShareButton brandName={brandName} compact />
        </div>
        <p className="hidden text-[13px] font-semibold text-fg-subtle sm:ml-auto sm:block">
          Te escribimos si hay lugar.
        </p>
      </div>

      {/* Gris mientras se envía; rojo y role="alert" solo con un error real */}
      <p
        role={showError ? "alert" : "status"}
        className={`text-sm empty:hidden ${showError ? "text-danger" : "text-fg-muted"}`}
      >
        {showError && state.status === "error" ? state.message : ""}
      </p>
    </form>
  );
}

/**
 * Qué guardamos y para qué (C8): debajo de la tarjeta del formulario, fuera de la primera pantalla
 * de acceso-pc.png (C10).
 */
export function WaitlistPrivacy({ contact }: { contact: FormProps["contact"] }) {
  return (
    <p className="text-xs text-fg-subtle">
      Guardamos tu nombre, email, carrera y cómo nos conociste solo para avisarte cuando haya lugar.
      Los ve solo quien administra el proyecto. Más info en{" "}
      <Link href="/legal/privacidad" className="underline">
        Privacidad
      </Link>
      .
      {contact ? (
        <>
          {" "}
          Para borrar tus datos, escribinos a{" "}
          <a href={contact.href} className="underline">
            {contact.email}
          </a>
          .
        </>
      ) : null}
    </p>
  );
}
