import type { ReactNode } from "react";

/**
 * Glosario (R5-C9; hallazgo 33 de `docs/ux/auditoria-r4.md`): los términos que la app usa en sus
 * pantallas, en una frase y sin jerga. Si cambia el nombre de algo en la app, cambia acá.
 */
export const GLOSARIO: ReadonlyArray<{ term: string; def: ReactNode }> = [
  {
    term: "Puntaje",
    def: "Un número de 0 a 10 que dice qué tan cerca está un aviso de tu perfil. Es una estimación para ayudarte a decidir: no garantiza que te llamen.",
  },
  {
    term: "Afín",
    def: "Qué tan parecido es un aviso a lo que sabés y buscás. El sello lo dice con palabras: «Muy afín», «Bastante afín», «Afín a medias», «Poco afín» o «Lejos de tu perfil».",
  },
  {
    term: "Estimación previa",
    def: "Un puntaje provisorio que calculamos con reglas, sin inteligencia artificial, mientras la oferta espera su evaluación. Todavía no es la evaluación.",
  },
  {
    term: "Evaluación",
    def: "La lectura completa de un aviso contra tu perfil: puntaje, qué tenés a favor, qué te falta o te frena y qué convendría hacer.",
  },
  {
    term: "Prefiltro",
    def: "El primer paso, hecho por código y sin inteligencia artificial: descarta los avisos que claramente no son para vos, como un puesto de otra disciplina o un cargo muy por encima de tu nivel. La ubicación no descarta: si no coincide, queda marcada como riesgo.",
  },
  {
    term: "Pool",
    def: "El conjunto de ofertas públicas que juntamos todos los días de distintas fuentes. De ahí salen tus primeras ofertas y los números de mercado.",
  },
  {
    term: "Te frena",
    def: "Un requisito del aviso que hoy no cumplís y que puede dejarte afuera, por ejemplo un nivel de inglés. Te lo marcamos para que decidas con esa información.",
  },
  {
    term: "Riesgo",
    def: "Algo del aviso que conviene mirar antes de postularte, como un sueldo que no se publica o una ubicación poco clara. No te descarta la oferta.",
  },
  {
    term: "Oferta sin descripción",
    def: "Un aviso que llegó sin el texto completo. Pegás la descripción y lo evaluamos con tu perfil.",
  },
];

export function Glosario() {
  return (
    <section
      id="glosario"
      aria-labelledby="glosario-titulo"
      className="flex scroll-mt-20 flex-col gap-4 rounded-card bg-surface p-5"
    >
      <h2 id="glosario-titulo" className="text-lg font-semibold text-fg">
        Glosario: las palabras de la app
      </h2>
      <dl className="flex flex-col gap-3">
        {GLOSARIO.map(({ term, def }) => (
          <div key={term} className="flex flex-col gap-0.5">
            <dt className="font-semibold text-fg">{term}</dt>
            <dd className="text-base leading-relaxed text-fg-muted">{def}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
