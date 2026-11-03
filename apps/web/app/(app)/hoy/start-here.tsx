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
 * «Para hacer hoy» («Empezá acá» de C8-5; C9-10): checklist de una persona nueva en /hoy, con el
 * check de marca en cada paso hecho (el rebote al tildarse llega en C9-14). Se marca sola con lo que ya está
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
          <h2 id="empeza-aca-titulo" className="text-heading font-bold text-fg">
            Para hacer hoy
          </h2>
          <p className="text-sm text-fg-muted">
            {done} de {total} listos. Con esto leemos cada oferta contra lo que buscás.
          </p>
        </div>
        <form action={closeStartHereAction}>
          <button
            type="submit"
            aria-label="Cerrar «Para hacer hoy»"
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
              className={`flex size-9 shrink-0 items-center justify-center rounded-pill ${
                step.done
                  ? "bg-success-muted text-success"
                  : "border-2 border-dashed border-line-control text-fg-muted"
              }`}
            >
              <Icon name={step.done ? "check" : STEP_ICON[step.id]} size={18} />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className={`text-[15px] ${step.done ? "text-fg-subtle line-through decoration-1" : "text-fg"} ${
                  step.id === next ? "font-bold" : "font-semibold"
                }`}
              >
                {step.title}
                <span className="sr-only"> {step.done ? "(hecho)" : "(pendiente)"}</span>
              </span>
              {step.help ? <span className="text-sm text-fg-muted">{step.help}</span> : null}
              {step.link ? (
                <Link
                  href={step.link.href}
                  className={
                    step.id === next
                      ? buttonClasses({ size: "sm", className: "mt-1 self-start" })
                      : textLinkClasses({ block: true })
                  }
                >
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
