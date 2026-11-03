/**
 * Ayuda en contexto (C8-6): las explicaciones cortas que se abren con «¿Qué es esto?» en las pantallas
 * donde una persona que no viene de tecnología más se traba. Todo el texto está acá para que Ani lo
 * edite sin tocar las pantallas.
 *
 * Cómo editar:
 * - Cambiá solo lo que está entre comillas. `tema` es lo que escucha un lector de pantalla después de
 *   «¿Qué es esto?»; `parrafos` es lo que se ve al abrirlo (cada línea es un párrafo).
 * - Frases cortas, de vos, sin palabras técnicas (M7: honestos, cercanos, respetuosos). Nada de
 *   «score», «skills», «pool», «LLM» ni «prompt».
 * - Un test (`ayuda-en-contexto.test.ts`, al lado de este archivo) revisa que ningún texto use esas palabras y que
 *   ninguno pase de 400 caracteres.
 */
export type AyudaTema = { tema: string; parrafos: readonly string[] };

export const AYUDA_EN_CONTEXTO = {
  /** Detalle de una oferta, junto al número del puntaje. */
  puntaje: {
    tema: "El puntaje",
    parrafos: [
      "Es un número del 1 al 10 que dice qué tan cerca está la oferta de tu perfil. Lo calculamos leyendo el aviso completo contra lo que nos contaste.",
      "Es una estimación, no una nota sobre vos. Un 8 o más suele valer la pena; con menos de 5, mirá qué te frena antes de postularte.",
    ],
  },
  /** Detalle de una oferta, en «A tu favor» y «Te falta o te frena». */
  aFavorTeFalta: {
    tema: "A tu favor y Te falta",
    parrafos: [
      "«A tu favor» es lo que el aviso pide y vos ya tenés. «Te falta» es lo que pide y no aparece en tu perfil.",
      "«Te frena» es algo que el aviso pide sí o sí, por ejemplo un idioma o vivir en otro país. «Ojo» es algo que conviene mirar, pero no es excluyente. «No sabemos» es algo que el aviso no dice.",
      "Si algo de esto no es cierto, actualizá tu perfil: la próxima vez lo leemos con eso.",
    ],
  },
  /** «Sin descripción»: ofertas que llegaron sin el texto del aviso. */
  sinDescripcion: {
    tema: "Las ofertas sin descripción",
    parrafos: [
      "Algunas ofertas llegan solo con el título, por ejemplo desde un email de alertas. Sin el texto del aviso no podemos decirte si te conviene.",
      "Abrí el aviso, copiá todo el texto del puesto y pegalo acá. En unos minutos la ves con su puntaje.",
    ],
  },
  /** «Tu CV». */
  cv: {
    tema: "Tu CV",
    parrafos: [
      "Armamos tu CV con lo que cargaste en tu perfil y en tu historial: trabajos, estudios y lo que sabés hacer.",
      "No inventamos nada: si falta algo, agregalo vos. Revisalo siempre antes de mandarlo.",
    ],
  },
  /** Ajustes → «Tus puestos», en las áreas de cada carrera. */
  areas: {
    tema: "Las áreas de tu carrera",
    parrafos: [
      "Dentro de una carrera hay trabajos muy distintos: en contaduría, impuestos no es lo mismo que auditoría. Marcá las áreas en las que querés trabajar.",
      "Por ahora te mostramos igual todas las ofertas de tu carrera: las áreas nos ayudan a saber qué buscás. Si te sirven todas, dejalas todas. Podés cambiarlas cuando quieras.",
    ],
  },
} as const satisfies Record<string, AyudaTema>;

export type AyudaClave = keyof typeof AYUDA_EN_CONTEXTO;
