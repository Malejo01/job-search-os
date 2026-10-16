/**
 * Checklist «Primeros pasos» de /jobs (ronda 49). Solo se tilda lo que los datos prueban; la web
 * junta los hechos (`FirstStepsFacts`) y esta función decide estado, texto y link. Puro, sin I/O.
 */

export type FirstStepsFacts = {
  /** Existe un `skill_levels` con level > 0. */
  skillsLoaded: boolean;
  /** Existe alguna oferta del usuario, de cualquier fuente. */
  hasJobs: boolean;
  /** Existe una evaluación con `human_verdict`. */
  hasVerdict: boolean;
  /** Existe una postulación. */
  hasApplication: boolean;
  /** Ya llegó algún email de alertas. */
  hasEmail: boolean;
  /** Tocó «No, gracias» en el aviso de email. */
  emailDeclined: boolean;
  /** La evaluada de mayor score sin opinión; null si no hay ninguna. */
  nextEvaluatedJobId: string | null;
};

export type FirstStepItem = {
  id: 1 | 2 | 3 | 4 | 5 | 6;
  done: boolean;
  /** El 6 no suma al contador ni a `complete`. */
  optional: boolean;
  text: string;
  help: string | null;
  link: { label: string; href: string } | null;
};

export type FirstStepsResult = {
  items: FirstStepItem[];
  /** Hechos entre los obligatorios (1 a 5). */
  done: number;
  total: number;
  complete: boolean;
};

export function firstSteps(facts: FirstStepsFacts): FirstStepsResult {
  const items: FirstStepItem[] = [
    {
      // Dentro de la app el gate de onboarding ya exige perfil completo
      id: 1,
      done: true,
      optional: false,
      text: "Completaste tu perfil",
      help: null,
      link: null,
    },
    {
      id: 2,
      done: facts.skillsLoaded,
      optional: false,
      text: facts.skillsLoaded ? "Cargaste tus skills" : "Cargá tus skills",
      help: null,
      link: facts.skillsLoaded ? null : { label: "Cargar mis skills", href: "/settings/skills" },
    },
    {
      id: 3,
      done: facts.hasJobs,
      optional: false,
      text: facts.hasJobs
        ? "Te llegaron tus primeras ofertas"
        : "Estamos buscando ofertas para tu puesto",
      help: null,
      link: null,
    },
    verdictItem(facts),
    {
      id: 5,
      done: facts.hasApplication,
      optional: false,
      text: facts.hasApplication
        ? "Registraste tu primera postulación"
        : "Cuando te postules, marcala como Aplicada",
      help: facts.hasApplication ? null : "En el detalle de la oferta, botón «Aplicada».",
      link: null,
    },
    emailItem(facts),
  ];
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  return { items, done, total: required.length, complete: done === required.length };
}

function verdictItem(facts: FirstStepsFacts): FirstStepItem {
  if (facts.hasVerdict) {
    return {
      id: 4,
      done: true,
      optional: false,
      text: "Le diste tu opinión a una oferta",
      help: null,
      link: null,
    };
  }
  const id = facts.nextEvaluatedJobId;
  return {
    id: 4,
    done: false,
    optional: false,
    text: "Abrí una oferta evaluada y dejá tu 👍/👎",
    help: id
      ? "Nos ayuda a ajustar los puntajes."
      : "Cuando haya una oferta evaluada, el link aparece acá",
    link: id ? { label: "Abrir la mejor evaluada", href: `/jobs/${id}` } : null,
  };
}

function emailItem(facts: FirstStepsFacts): FirstStepItem {
  const base = { id: 6 as const, optional: true, help: null };
  if (facts.hasEmail) {
    return { ...base, done: true, text: "Tus alertas de email llegan", link: null };
  }
  if (facts.emailDeclined) {
    return { ...base, done: false, text: "Alertas de email: no por ahora", link: null };
  }
  return {
    ...base,
    done: false,
    text: "Conectá tus alertas de email (opcional)",
    link: { label: "Conectar (5 min)", href: "/settings/asistente" },
  };
}
