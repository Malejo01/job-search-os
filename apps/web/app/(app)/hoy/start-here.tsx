import { startHere, type StartHereStepId } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { Card, Icon, buttonClasses, textLinkClasses, type IconName } from "@/components/ui";
import { requireActiveUserId } from "@/lib/session";
import { getStartHereFacts, startHereEnabled } from "@/lib/start-here";

/** Cookie de «Cerrar»: solo UX (httpOnly, un año), con el id del usuario como valor. */
const START_HERE_COOKIE = "jso_empeza_aca";
const MAX_AGE = 60 * 60 * 24 * 365;

const STEP_ICON: Record<StartHereStepId, IconName> = {
  perfil: "perfil",
  areas: "filtro",
  ofertas: "pegar",
  cv: "cv",
};

/** «Cerrar»: guarda la cookie y la tarjeta no vuelve. No toca la base. */
async function closeStartHereAction(): Promise<void> {
  "use server";
  // El valor es el id del usuario: en un navegador compartido, cerrarla en una cuenta no la cierra en otra
  const userId = await requireActiveUserId();
  const jar = await cookies();
  jar.set(START_HERE_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  revalidatePath("/hoy");
}

/**
 * «Empezá acá» (C8-5): checklist de una persona nueva en /hoy. Se marca sola con lo que ya está
 * guardado, desaparece al completarla y se puede cerrar. Apagada salvo `START_HERE_ENABLED=1`.
 * Server Component: cerrada o apagada, no consulta nada.
 */
export async function StartHere({ userId }: { userId: string }) {
  if (!startHereEnabled()) return null;
  const jar = await cookies();
  if (jar.get(START_HERE_COOKIE)?.value === userId) return null;
  const facts = await getStartHereFacts(userId).catch(() => null);
  if (!facts) return null;
  const { steps, done, total, complete, next } = startHere(facts);
  if (complete) return null;

  return (
    <Card
      as="section"
      padding="md"
      data-testid="empeza-aca"
      aria-labelledby="empeza-aca-titulo"
      className="flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="empeza-aca-titulo" className="text-base font-bold text-fg">
            Empezá acá
          </h2>
          <p className="text-sm text-fg-muted">
            {done} de {total} listos. Con esto, las ofertas que te mostramos se parecen más a lo que
            buscás.
          </p>
        </div>
        <form action={closeStartHereAction}>
          <button
            type="submit"
            aria-label="Cerrar «Empezá acá»"
            className={buttonClasses({ variant: "ghost", size: "sm", className: "min-h-11" })}
          >
            Cerrar
          </button>
        </form>
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step) => (
          <li
            key={step.id}
            data-testid={`empeza-aca-${step.id}`}
            data-done={step.done ? "true" : "false"}
            className="flex items-start gap-3"
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-pill ${
                step.done ? "bg-success-soft text-success" : "bg-surface-subtle text-fg-muted"
              }`}
            >
              {step.done ? "✓" : <Icon name={STEP_ICON[step.id]} size={16} />}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className={`text-sm ${step.done ? "text-fg-subtle" : "text-fg"} ${
                  step.id === next ? "font-bold" : "font-semibold"
                }`}
              >
                {step.title}
                <span className="sr-only"> {step.done ? "(hecho)" : "(pendiente)"}</span>
              </span>
              {step.help ? <span className="text-sm text-fg-muted">{step.help}</span> : null}
              {step.link ? (
                <Link href={step.link.href} className={textLinkClasses({ block: true })}>
                  {step.link.label}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
