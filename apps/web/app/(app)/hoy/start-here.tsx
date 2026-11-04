import { startHere, type StartHereStepId } from "@job-search-os/pipeline";
import { cookies } from "next/headers";
import Link from "next/link";
import { buttonClasses, cardClasses, CheckMark } from "@/components/ui";
import { CheckBounce } from "@/components/motion/check-bounce";
import { getStartHereFacts, startHereEnabled } from "@/lib/start-here";

/**
 * Cookie de «Cerrar» de C8-5. Desde C10 la tarjeta no tiene «Cerrar» (hoy-pc.png): se va sola
 * cuando no queda nada pendiente. Se sigue leyendo para quien ya la había cerrado.
 */
const START_HERE_COOKIE = "jso_empeza_aca";

type Task = {
  id: StartHereStepId | "descripciones" | "seguimiento";
  done: boolean;
  /** Dicho como algo para hacer, también cuando ya está hecho (va tachado). */
  title: string;
  link: { href: string; button: string } | null;
};

/**
 * Los pasos de «Empezá acá» (C8-5) dichos como en la pantalla aprobada: lo que se hace, en
 * infinitivo. El perfil solo aparece mientras falta, y «tener ofertas» solo si todavía no hay.
 */
const STEP_TASK: Record<StartHereStepId, { title: string; button: string }> = {
  perfil: { title: "Completar tu perfil", button: "Completar mi perfil" },
  areas: { title: "Elegir tus áreas", button: "Elegir mis áreas" },
  ofertas: { title: "Pegar una oferta", button: "Pegar una oferta" },
  cv: { title: "Subir tu CV", button: "Armar mi CV" },
};

/**
 * «Para hacer hoy» (C10-6, hoy-pc.png y hoy-cel.png; `.cardl`, `.chk` y `.chk0` del tablero):
 * los pasos de una persona que empieza («Empezá acá» de C8-5, detrás de `START_HERE_ENABLED`) más
 * lo que hay para hacer con sus datos: pegar las descripciones que faltan y hacer el seguimiento de
 * las postulaciones. Lo hecho va tachado con el check lima; lo pendiente, con el aro. La primera
 * pendiente lleva su botón; las demás son links. Si no queda nada pendiente, no se muestra. En el
 * celular se ve solo el último paso hecho. Server Component.
 */
export async function StartHere({
  userId,
  pendingJd,
  followUps,
}: {
  userId: string;
  /** Ofertas que esperan la descripción. */
  pendingJd: number;
  /** Postulaciones para hacer el seguimiento hoy. */
  followUps: number;
}) {
  const jar = await cookies();
  if (jar.get(START_HERE_COOKIE)?.value === userId) return null;
  const facts = startHereEnabled() ? await getStartHereFacts(userId).catch(() => null) : null;

  const tasks: Task[] = [];
  if (facts) {
    for (const step of startHere(facts).steps) {
      if (step.done && (step.id === "perfil" || step.id === "ofertas")) continue;
      tasks.push({
        id: step.id,
        done: step.done,
        title: STEP_TASK[step.id].title,
        link: step.link ? { href: step.link.href, button: STEP_TASK[step.id].button } : null,
      });
    }
  }
  if (pendingJd > 0) {
    tasks.push({
      id: "descripciones",
      done: false,
      title:
        pendingJd === 1
          ? "Pegar la descripción de 1 oferta"
          : `Pegar la descripción de ${pendingJd} ofertas`,
      link: {
        href: "/jobs/pending-jd",
        button: pendingJd === 1 ? "Pegar la descripción" : "Pegar descripciones",
      },
    });
  }
  if (followUps > 0) {
    tasks.push({
      id: "seguimiento",
      done: false,
      title:
        followUps === 1
          ? "Hacer el seguimiento de 1 postulación"
          : `Hacer el seguimiento de ${followUps} postulaciones`,
      link: { href: "/applications#seguimiento", button: "Ver mis postulaciones" },
    });
  }
  const pending = tasks.filter((t) => !t.done);
  if (pending.length === 0) return null;
  const next = pending[0]!;
  const lastDone = tasks.filter((t) => t.done).at(-1);

  return (
    <section
      data-testid="empeza-aca"
      aria-labelledby="empeza-aca-titulo"
      className={cardClasses({
        level: "list",
        padding: "none",
        className: "relative flex flex-col gap-2.5 p-4 sm:gap-3.5 sm:p-[22px]",
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          id="empeza-aca-titulo"
          className="font-display text-[17px] font-extrabold text-fg sm:text-xl"
        >
          Para hacer hoy
        </h2>
        <span className="sr-only">
          {tasks.length - pending.length} de {tasks.length} listos.
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0 sm:gap-3.5">
        {tasks.map((task) => (
          <li
            key={task.id}
            data-testid={`empeza-aca-${task.id}`}
            data-done={task.done ? "true" : "false"}
            className={`items-center gap-2.5 ${task.done && task !== lastDone ? "hidden sm:flex" : "flex"}`}
          >
            <CheckBounce id={`${userId}:${task.id}`} done={task.done}>
              <CheckMark done={task.done} />
            </CheckBounce>
            {task.done ? (
              <span className="text-sm font-semibold text-fg-subtle line-through sm:text-[15px]">
                {task.title}
                <span className="sr-only"> (hecho)</span>
              </span>
            ) : task.link ? (
              <Link
                href={task.link.href}
                className="text-sm font-bold text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus sm:text-[15px]"
              >
                {task.title}
                <span className="sr-only"> (pendiente)</span>
              </Link>
            ) : (
              <span className="text-sm font-bold text-fg sm:text-[15px]">
                {task.title}
                <span className="sr-only"> (pendiente)</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {/* El botón de la primera pendiente; en el celular el paso ya es el link (hoy-cel.png) */}
      {next.link ? (
        <div className="mt-1 hidden sm:block">
          <Link
            href={next.link.href}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            {next.link.button}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
