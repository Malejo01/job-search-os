import { isRoleKey } from "./skills/self-assessment";
import { specialtiesFor } from "./skills/specialties";

/**
 * «Empezá acá» de /hoy (C8-5): la checklist de una persona nueva, pensada para las carreras no tech.
 * Cada paso se marca solo con datos que la app ya guarda (sin migración); la web junta los hechos y
 * esta función decide qué pasos van, en qué estado y con qué link. Puro, sin I/O. Textos según M7:
 * frases cortas, de vos, sin jerga.
 */
export type StartHereFacts = {
  /** El perfil tiene resumen (se pide en el onboarding; puede haberse borrado después). */
  summaryFilled: boolean;
  /** Hay al menos un nivel de «lo que sabés hacer» mayor a 0 (`skill_levels`). */
  skillsLoaded: boolean;
  /** Carreras elegidas (claves de ROLE_KEYS). */
  targetRoles: readonly string[];
  /** `profiles.target_specialties` no es null: la persona guardó sus áreas al menos una vez. */
  specialtiesSaved: boolean;
  /** Tiene alguna oferta, de cualquier fuente (pegada, por email o del pool). */
  hasJobs: boolean;
  /** El chat «Armá tu CV» está habilitado para esta persona (`CV_CHAT_ENABLED`). */
  cvEnabled: boolean;
  /** Hay algo guardado en su historial para el CV (`career_history`). */
  cvStarted: boolean;
};

export type StartHereStepId = "perfil" | "areas" | "ofertas" | "cv";

export type StartHereStep = {
  id: StartHereStepId;
  done: boolean;
  title: string;
  help: string | null;
  link: { label: string; href: string } | null;
};

export type StartHereResult = {
  steps: StartHereStep[];
  done: number;
  total: number;
  complete: boolean;
  /** El primer paso pendiente (se resalta); null si está todo hecho. */
  next: StartHereStepId | null;
};

/** ¿Alguna de las carreras elegidas tiene áreas para elegir (chips de especialidad, ADR-027)? */
export function hasAreasToChoose(targetRoles: readonly string[]): boolean {
  return targetRoles.some((r) => isRoleKey(r) && specialtiesFor(r).length > 0);
}

export function startHere(facts: StartHereFacts): StartHereResult {
  const steps: StartHereStep[] = [profileStep(facts)];
  if (hasAreasToChoose(facts.targetRoles)) {
    steps.push(
      facts.specialtiesSaved
        ? { id: "areas", done: true, title: "Elegiste tus áreas", help: null, link: null }
        : {
            id: "areas",
            done: false,
            title: "Elegí tus áreas",
            help: "Dentro de tu carrera, marcá en qué querés trabajar. Si te sirven todas, dejalas todas y guardá.",
            link: { label: "Elegir mis áreas", href: "/settings#puesto" },
          },
    );
  }
  steps.push(
    facts.hasJobs
      ? { id: "ofertas", done: true, title: "Ya tenés ofertas para mirar", help: null, link: null }
      : {
          id: "ofertas",
          done: false,
          title: "Pegá una oferta o esperá las nuestras",
          help: "Si viste un aviso que te interesa, pegalo y lo leemos contra tu perfil. Si no, todos los días sumamos ofertas de tu carrera.",
          link: { label: "Pegar una oferta", href: "/jobs/new" },
        },
  );
  if (facts.cvEnabled) {
    steps.push(
      facts.cvStarted
        ? { id: "cv", done: true, title: "Empezaste tu CV", help: null, link: null }
        : {
            id: "cv",
            done: false,
            title: "Armá tu CV",
            help: "Te hacemos preguntas y lo armamos con tus respuestas. Lo revisás antes de usarlo.",
            link: { label: "Armar mi CV", href: "/cv/armar" },
          },
    );
  }
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    next: steps.find((s) => !s.done)?.id ?? null,
  };
}

function profileStep(facts: StartHereFacts): StartHereStep {
  if (facts.summaryFilled && facts.skillsLoaded) {
    return { id: "perfil", done: true, title: "Completaste tu perfil", help: null, link: null };
  }
  return {
    id: "perfil",
    done: false,
    title: "Completá tu perfil",
    help: facts.summaryFilled
      ? "Contanos qué sabés hacer: con eso leemos cada oferta."
      : "Contanos en pocas líneas qué hiciste y qué buscás: con eso leemos cada oferta.",
    link: facts.summaryFilled
      ? { label: "Contar qué sé hacer", href: "/settings/skills" }
      : { label: "Completar mi perfil", href: "/settings/perfil" },
  };
}
