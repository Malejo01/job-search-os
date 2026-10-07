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
  returnTo?: "/settings" | "/onboarding";
}) {
  return (
    <details open={error} className="rounded-md border border-red-200 bg-red-50/40 p-3">
      <summary className="cursor-pointer text-sm font-medium text-red-800">
        Eliminar mi cuenta
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm text-zinc-700">
        <p>
          Se borran tu perfil, criterios, ofertas, evaluaciones, postulaciones, contactos, emails
          recibidos y sus originales, skills, plan de formación, respuestas guardadas, el historial
          de llamadas al modelo y las invitaciones que creaste. Después se borra tu usuario y se
          cierra la sesión.
        </p>
        <p className="font-medium text-red-800">
          Es irreversible: no hay copia ni forma de recuperarla.
        </p>
        {error ? (
          <p role="alert" className="text-red-700">
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
              className="rounded-md border border-zinc-300 px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1">
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="rounded-md border border-zinc-300 px-3 py-2 text-base"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-red-700 px-4 py-2 text-base font-medium text-white"
          >
            Eliminar mi cuenta para siempre
          </button>
        </form>
      </div>
    </details>
  );
}
