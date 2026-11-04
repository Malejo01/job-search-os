import { buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { deleteAccountAction } from "./actions";

/**
 * Formulario de eliminación de cuenta (JS-092), compartido por /settings y /onboarding (un invitado
 * sin onboarding no pasa el gate de (app), pero tiene que poder suprimir sus datos).
 * `returnTo` es a dónde vuelve la acción si el email o la contraseña no coinciden.
 */
export function DeleteAccountForm({
  error,
  returnTo = "/settings",
}: {
  error: boolean;
  returnTo?: "/settings" | "/onboarding" | "/terminos-actualizados";
}) {
  return (
    <details
      open={error}
      className={cardClasses({ tone: "danger", padding: "none", className: "px-4 py-1" })}
    >
      <summary className="cursor-pointer text-sm font-bold text-danger">Eliminar mi cuenta</summary>
      <div className="mt-2 mb-3 flex flex-col gap-3 text-sm text-fg-muted">
        <p>
          Se borran tu perfil, criterios, ofertas, evaluaciones, postulaciones, contactos, emails
          recibidos y sus originales, skills, plan de formación, respuestas guardadas, el historial
          de llamadas al modelo y las invitaciones que creaste. Después se borra tu usuario y se
          cierra la sesión.
        </p>
        <p className="font-bold text-danger">Es irreversible: no podemos recuperarla.</p>
        {error ? (
          <p role="alert" className="text-danger">
            El email o la contraseña no coinciden. No se borró nada.
          </p>
        ) : null}
        <form action={deleteAccountAction} className="flex flex-col gap-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="flex flex-col gap-1.5">
            Escribí tu email para confirmar
            <input
              name="email"
              type="email"
              autoComplete="off"
              required
              className={inputClasses()}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClasses()}
            />
          </label>
          <button
            type="submit"
            className={buttonClasses({ variant: "danger", className: "self-start" })}
          >
            Eliminar mi cuenta para siempre
          </button>
        </form>
      </div>
    </details>
  );
}
