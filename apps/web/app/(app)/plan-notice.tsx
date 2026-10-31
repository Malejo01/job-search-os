import type { PlanAccess } from "@job-search-os/pipeline";
import Link from "next/link";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Aviso de la vigencia del acceso (C3-1), arriba de toda la app con sesión. Aparece solo en los últimos 3
 * días y cuando el plan ya venció; el resto del tiempo no hay nada que avisar. Vencer no borra nada: el
 * texto lo dice. Server Component: sin JavaScript en el navegador. Los datos salen de `planAccess`.
 */
export function PlanNotice({ access }: { access: PlanAccess }) {
  if (access.status !== "por_vencer" && access.status !== "vencido") return null;
  const vencido = access.status === "vencido";
  return (
    <div
      role="status"
      data-testid="aviso-plan"
      className={`mb-4 flex flex-col gap-1 rounded-control border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
        vencido
          ? "border-warning-line bg-warning-soft text-warning"
          : "border-info-line bg-info-soft text-info"
      }`}
    >
      <p>
        {vencido ? (
          <>
            Tu acceso a la beta venció{access.until ? ` el ${DATE.format(access.until)}` : ""}. Tus
            datos siguen guardados y ahora rige el plan gratis, con menos ofertas por día.
          </>
        ) : (
          <>
            {access.daysLeft === 1 ? "Te queda 1 día" : `Te quedan ${access.daysLeft} días`} de
            acceso a la beta
            {access.until ? ` (hasta el ${DATE.format(access.until)})` : ""}.
          </>
        )}
      </p>
      <Link
        href="/settings#tu-plan"
        className="inline-flex min-h-11 shrink-0 items-center font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {vencido ? "Cómo volver al plan completo" : "Cómo renovar"}
      </Link>
    </div>
  );
}
