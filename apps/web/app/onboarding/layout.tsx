import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { assertAppRole } from "@/lib/db";
import { requireUserId } from "@/lib/session";

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/**
 * Layout mínimo del onboarding: vive fuera de (app) para que el gate de ese layout no entre en
 * loop, pero igual exige sesión (el middleware ya lo pide; requireUserId es el cinturón).
 */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await assertAppRole();
  await requireUserId();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <span className="text-base font-semibold">Job Search OS</span>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-zinc-600 underline-offset-2 hover:underline"
            >
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
