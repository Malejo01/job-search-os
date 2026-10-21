"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { submitWaitlist, type WaitlistState } from "./actions";

const INITIAL: WaitlistState = { status: "idle" };
const field = "min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-base";

export type RoleOption = { key: string; label: string };
export type RoleOptionGroup = { label: string; roles: RoleOption[] };

/** Formulario "Pedir acceso". Las carreras las arma la página (servidor) para no traer la base al cliente. */
export function WaitlistForm({
  groups,
  contact,
}: {
  groups: RoleOptionGroup[];
  contact: { email: string; href: string } | null;
}) {
  const [state, action, pending] = useActionState(submitWaitlist, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  // Mientras se envía no se muestran los errores del intento anterior
  const showError = state.status === "error" && !pending;
  const errors = showError && state.fieldErrors ? state.fieldErrors : {};

  // Con errores de campo, el foco va al primer campo inválido
  useEffect(() => {
    if (state.status !== "error" || !state.fieldErrors) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  if (state.status === "done") {
    return (
      <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-base text-emerald-900">
        {state.message}
      </p>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <p className="text-base text-zinc-700">
        La beta es por invitación. Dejá tus datos y, cuando haya lugar, te escribimos con un link
        para crear tu cuenta.
      </p>
      <label className="flex flex-col gap-1 text-sm">
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
          <span id="acceso-name-error" className="text-sm text-red-700">
            {errors.name}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-required="true"
          maxLength={254}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "acceso-email-error" : undefined}
          className={field}
        />
        {errors.email ? (
          <span id="acceso-email-error" className="text-sm text-red-700">
            {errors.email}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Carrera
        <select
          name="role"
          required
          aria-required="true"
          defaultValue=""
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
          <span id="acceso-role-error" className="text-sm text-red-700">
            {errors.role}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        ¿Cómo te enteraste? (opcional)
        <input
          name="heardFrom"
          type="text"
          maxLength={200}
          aria-invalid={errors.heardFrom ? true : undefined}
          aria-describedby={
            errors.heardFrom ? "acceso-heard-hint acceso-heard-error" : "acceso-heard-hint"
          }
          className={field}
        />
        <span id="acceso-heard-hint" className="text-xs text-zinc-600">
          No pongas datos personales.
        </span>
        {errors.heardFrom ? (
          <span id="acceso-heard-error" className="text-sm text-red-700">
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
        className="min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
      >
        {pending ? "Enviando…" : "Pedir acceso"}
      </button>

      {/* Gris mientras se envía; rojo y role="alert" solo con un error real */}
      <p
        role={showError ? "alert" : "status"}
        className={`min-h-5 text-sm ${showError ? "text-red-700" : "text-zinc-700"}`}
      >
        {showError && state.status === "error" ? state.message : ""}
      </p>

      <p className="text-xs text-zinc-600">
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
