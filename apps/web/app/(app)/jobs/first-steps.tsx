import { firstSteps } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { EMAIL_NUDGE_COOKIE } from "@/app/components/email-nudge";
import { getFirstStepsFacts } from "@/lib/first-steps";
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
        className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
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
        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
      >
        <h2 id="primeros-pasos-titulo" className="sr-only">
          Primeros pasos
        </h2>
        <p>
          <span aria-hidden="true">✓</span> ¡Listo! Ya sabés usar lo básico. Lo que sigue: revisar
          las ofertas verdes cada día.
        </p>
        {hide}
      </section>
    );
  }

  // Con un solo paso obligatorio por hacer, la lista va plegada: el summary ya dice cuál es
  const pendingRequired = items.filter((i) => !i.optional && !i.done);
  const onlyOneMissing = pendingRequired.length === 1;
  const missing = pendingRequired[0];
  const list = (
    <ol className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.id}
          className={`flex gap-2 ${item.done ? "text-zinc-500" : "text-zinc-900"} ${
            item.id === firstPending ? "font-semibold" : ""
          }`}
        >
          <span aria-hidden="true" className="w-4 shrink-0">
            {item.done ? "✓" : "○"}
          </span>
          <div className="flex min-w-0 flex-col">
            <span>
              {item.text}
              <span className="sr-only"> {item.done ? "(hecho)" : "(pendiente)"}</span>
            </span>
            {item.help ? (
              <span className="text-xs font-normal text-zinc-600">{item.help}</span>
            ) : null}
            {item.link ? (
              <Link
                href={item.link.href}
                className="inline-flex min-h-11 items-center font-medium text-sky-700 underline"
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
      className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 text-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="primeros-pasos-titulo" className="font-semibold">
          Primeros pasos
        </h2>
        <p className="text-xs text-zinc-600" data-testid="first-steps-count">
          {done} de {total}
        </p>
      </div>
      {onlyOneMissing ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900">
            <span aria-hidden="true" className="group-open:hidden">
              ▸
            </span>
            <span aria-hidden="true" className="hidden group-open:inline">
              ▾
            </span>
            Te falta un paso: {missing?.text}
          </summary>
          {list}
        </details>
      ) : (
        list
      )}
      <div className="flex justify-end">{hide}</div>
    </section>
  );
}
