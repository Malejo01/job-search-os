import type { ReactNode } from "react";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { requireUserId } from "@/lib/session";
import { AdminNav } from "./admin-nav";

/**
 * Marco del panel /admin (ADM-1), con el modelo de MaestrIA: barra lateral en escritorio y pestañas arriba
 * en el celular. Quien no es admin recibe un 404 acá, y cada página y acción vuelve a comprobarlo (el test
 * de `admin-routes` lo exige): si no es para vos, la página no existe.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminOr404(await requireUserId());
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <AdminNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
