"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
// R-1: import directo (el barril de `@/components/ui` arrastra el de pipeline al navegador)
import { buttonClasses } from "@/components/ui/button";
import { submitWaitlist, trackAcceso, type WaitlistState } from "./actions";
import { ShareButton } from "./share-button";

const INITIAL: WaitlistState = { status: "idle" };
// Campo del manual (M8, C7-10): borde de 2 px, radio 12, 44 px y foco lima
const field =
  "min-h-12 w-full rounded-control border-2 border-line-control bg-surface px-3 py-2 text-base text-fg focus-visible:border-focus aria-invalid:border-danger-strong";

export type RoleOption = { key: string; label: string };
export type RoleOptionGroup = { label: string; roles: RoleOption[] };

type FormProps = {
  groups: RoleOptionGroup[];
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
  contact,
  initialHeardFrom,
  funnel = false,
  origen = null,
  brandName,
}: FieldsProps) {
  const [state, action, pending] = useActionState(submitWaitlist, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);
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
      className="flex flex-col gap-4"
      noValidate
    >
      {origen ? <input type="hidden" name="origen" value={origen.slice(0, 40)} /> : null}
      <p className="text-base text-fg-muted">
        La beta es por invitación. Dejá tus datos y, cuando haya lugar, te escribimos con un link
        para crear tu cuenta.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Nombre
        <input
          name="name"
          type="text"
          autoComplete="name"
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

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Email
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
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

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Carrera
        <select
          name="role"
          required
          aria-required="true"
          defaultValue=""
          onChange={
            funnel
              ? (e) => void trackAcceso("carrera", origen, e.target.value).catch(() => {})
              : undefined
          }
          aria-invalid={errors.role ? true : undefined}
          aria-describedby={errors.role ? "acceso-role-error" : undefined}
          className={field}
        >
          <option value="" disabled>
            Elegí una carrera
          </option>
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
        {errors.role ? (
          <span id="acceso-role-error" className="text-sm font-semibold text-danger">
            {errors.role}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
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

      {/* Honeypot: fuera de pantalla y fuera del orden de tabulación; las personas no lo completan */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          No completar este campo
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className={buttonClasses({ className: "min-h-12 w-full text-base" })}
      >
        {pending ? "Enviando…" : "Pedir acceso"}
      </button>

      {/* Gris mientras se envía; rojo y role="alert" solo con un error real */}
      <p
        role={showError ? "alert" : "status"}
        className={`min-h-5 text-sm ${showError ? "text-danger" : "text-fg-muted"}`}
      >
        {showError && state.status === "error" ? state.message : ""}
      </p>

      <p className="text-xs text-fg-subtle">
        Guardamos tu nombre, email, carrera y cómo nos conociste solo para avisarte cuando haya
        lugar. Los ve solo quien administra el proyecto. Más info en{" "}
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
    </form>
  );
}
