import { PRODUCT_NAME } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { assertAppRole } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { DeleteAccountForm } from "../(app)/settings/delete-account-form";
import { AcceptTermsForm } from "./form";

export const metadata: Metadata = { title: "Actualizamos los términos" };
export const dynamic = "force-dynamic";

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

const LINK = "inline-flex min-h-11 items-center underline underline-offset-2";

/**
 * Re-aceptación de los términos (ronda 83). Vive fuera de (app) y de /onboarding para que sus gates no
 * entren en loop. Sin Ajustes a mano (también está detrás del gate), ofrece cerrar sesión o eliminar la
 * cuenta desde acá. Quien ya está al día va a /hoy.
 */
export default async function TermsUpdatedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await assertAppRole();
  const userId = await requireUserId();
  if (!(await needsTermsAcceptance(userId))) redirect("/hoy");
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <span className="text-base font-semibold">{PRODUCT_NAME}</span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">
        <h1 className="text-xl font-semibold">
          Actualizamos los términos y la política de privacidad
        </h1>
        <p className="text-sm text-zinc-700">
          Para seguir usando la app, leé los cambios y aceptalos.
        </p>
        <ul className="flex list-none flex-col p-0 text-sm">
          <li>
            <a href="/legal/terminos" target="_blank" rel="noopener" className={LINK}>
              Términos de uso
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </li>
          <li>
            <a href="/legal/privacidad" target="_blank" rel="noopener" className={LINK}>
              Política de privacidad
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </li>
        </ul>
        <AcceptTermsForm />
        <div className="mt-2 flex flex-col gap-3 border-t border-zinc-200 pt-4">
          <form action={logout}>
            <button
              type="submit"
              className="min-h-11 text-sm text-zinc-700 underline underline-offset-2"
            >
              Cerrar sesión
            </button>
          </form>
          <p className="text-sm text-zinc-700">
            ¿No estás de acuerdo? Podés eliminar tu cuenta desde acá.
          </p>
          {/* A-12: el error vuelve acá; antes iba a /onboarding, que lo mandaba de vuelta sin mensaje */}
          <DeleteAccountForm error={error === "confirmacion"} returnTo="/terminos-actualizados" />
        </div>
      </main>
    </div>
  );
}
