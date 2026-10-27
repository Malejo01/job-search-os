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
      className="rounded-control border border-danger-line bg-danger-soft/40 p-3"
    >
      <summary className="cursor-pointer text-sm font-medium text-danger">
        Eliminar mi cuenta
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm text-fg-muted">
        <p>
          Se borran tu perfil, criterios, ofertas, evaluaciones, postulaciones, contactos, emails
          recibidos y sus originales, skills, plan de formación, respuestas guardadas, el historial
          de llamadas al modelo y las invitaciones que creaste. Después se borra tu usuario y se
          cierra la sesión.
        </p>
        <p className="font-medium text-danger">Es irreversible: no podemos recuperarla.</p>
        {error ? (
          <p role="alert" className="text-danger">
            El email o la contraseña no coinciden. No se borró nada.
          </p>
        ) : null}
        <form action={deleteAccountAction} className="flex flex-col gap-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="flex flex-col gap-1">
            Escribí tu email para confirmar
            <input
              name="email"
              type="email"
              autoComplete="off"
              required
              className="rounded-control border border-line-strong px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1">
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="rounded-control border border-line-strong px-3 py-2 text-base"
            />
          </label>
          <button
            type="submit"
            className="rounded-control bg-danger-strong px-4 py-2 text-base font-medium text-on-strong"
          >
            Eliminar mi cuenta para siempre
          </button>
        </form>
      </div>
    </details>
  );
}
