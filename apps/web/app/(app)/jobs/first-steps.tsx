import { firstSteps } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { EMAIL_NUDGE_COOKIE } from "@/app/components/email-nudge";
import { getFirstStepsFacts } from "@/lib/first-steps";
import { CheckMark, Icon } from "@/components/ui";
import { requireActiveUserId } from "@/lib/session";

/** Cookie de «Ocultar»: solo UX (httpOnly, un año), con el id del usuario como valor. */
const FIRST_STEPS_COOKIE = "jso_primeros_pasos";
const FIRST_STEPS_MAX_AGE = 60 * 60 * 24 * 365;

/** «Ocultar»: guarda la cookie y la checklist no vuelve. No toca la base. */
async function hideFirstStepsAction(): Promise<void> {
  "use server";
  // El valor es el id del usuario (sale de la sesión): en un navegador compartido ocultarla
  // en una cuenta no la oculta en otra
  const userId = await requireActiveUserId();
  const jar = await cookies();
  jar.set(FIRST_STEPS_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FIRST_STEPS_MAX_AGE,
  });
  revalidatePath("/jobs");
}

/** ¿La persona ocultó la checklist? Lee solo la cookie: cero queries. */
export async function firstStepsHidden(userId: string): Promise<boolean> {
  const jar = await cookies();
  return jar.get(FIRST_STEPS_COOKIE)?.value === userId;
}

/**
 * Checklist «Primeros pasos» de /jobs. Solo se tilda lo que los datos prueban. Server Component:
 * con la cookie de «Ocultar» no consulta nada.
 */
export async function FirstSteps({ userId }: { userId: string }) {
  if (await firstStepsHidden(userId)) return null;
  const jar = await cookies();
  const facts = await getFirstStepsFacts(userId);
  const emailDeclined = jar.get(EMAIL_NUDGE_COOKIE)?.value === userId;
  const { items, done, total, complete } = firstSteps({ ...facts, emailDeclined });
  const firstPending = items.find((i) => !i.optional && !i.done)?.id;

  const hide = (
    <form action={hideFirstStepsAction}>
      <button
        type="submit"
        className="min-h-11 rounded-control border border-line-strong bg-surface px-3 py-1 text-sm text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        Ocultar
      </button>
    </form>
  );

  if (complete) {
    return (
      <section
        aria-labelledby="primeros-pasos-titulo"
        data-testid="first-steps"
        data-tour="jobs:primeros-pasos"
        className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-success-soft px-3 py-2 text-sm text-success"
      >
        <h2 id="primeros-pasos-titulo" className="sr-only">
          Primeros pasos
        </h2>
        <p className="flex items-center gap-2">
          <CheckMark done className="size-5" />
          <span>
            ¡Listo! Ya sabés usar lo básico. Lo que sigue: revisar cada día las ofertas con mejor
            puntaje (las verdes).
          </span>
        </p>
        {hide}
      </section>
    );
  }

  // R5-C9 (hallazgo 18): la lista va siempre plegada, en una línea, para que la primera oferta
  // quede a la vista. Con un solo paso por hacer, el summary ya dice cuál es.
  const pendingRequired = items.filter((i) => !i.optional && !i.done);
  const onlyOneMissing = pendingRequired.length === 1;
  const missing = pendingRequired[0];
  const list = (
    <ol className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.id}
          className={`flex gap-2 ${item.done ? "text-fg-subtle" : "text-fg"} ${
            item.id === firstPending ? "font-semibold" : ""
          }`}
        >
          <CheckMark done={item.done} className="mt-0.5 size-5 text-xs" />
          <div className="flex min-w-0 flex-col">
            <span>
              {item.text}
              <span className="sr-only"> {item.done ? "(hecho)" : "(pendiente)"}</span>
            </span>
            {item.help ? (
              <span className="text-xs font-normal text-fg-subtle">{item.help}</span>
            ) : null}
            {item.link ? (
              <Link
                href={item.link.href}
                className="inline-flex min-h-11 items-center font-medium text-link underline"
              >
                {item.link.label}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );

  return (
    <section
      aria-labelledby="primeros-pasos-titulo"
      data-testid="first-steps"
      data-tour="jobs:primeros-pasos"
      className="flex items-start gap-2 rounded-card border-2 border-line bg-surface px-3 py-1 text-sm"
    >
      {/* R11-13: en el celular, una sola línea (título, avance y el paso que falta, con puntos
          suspensivos) para que la primera oferta entre en la primera pantalla; «Ocultar» al costado */}
      <details className="group min-w-0 flex-1">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
          <Icon name="mas" size={16} className="shrink-0 text-fg-subtle group-open:hidden" />
          <Icon name="cruz" size={16} className="hidden shrink-0 text-fg-subtle group-open:block" />
          <h2 id="primeros-pasos-titulo" className="shrink-0 font-semibold">
            Primeros pasos
          </h2>
          <span className="shrink-0 text-xs text-fg-subtle" data-testid="first-steps-count">
            {done} de {total}
          </span>
          <span className="min-w-0 truncate text-fg-muted">
            {onlyOneMissing ? `Te falta un paso: ${missing?.text}` : "Ver los pasos"}
          </span>
        </summary>
        <div className="pb-2">{list}</div>
      </details>
      <div className="shrink-0 pt-0.5">{hide}</div>
    </section>
  );
}
