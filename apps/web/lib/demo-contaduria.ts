import type { FitPoints } from "@job-search-os/pipeline";

/**
 * Ejemplo fijo para /demo/contaduria (C7-13): una persona de contaduría y cinco ofertas, todo
 * inventado y determinista (sin base, sin IA, sin fechas que cambien). Sirve para mostrar el
 * producto en el celular y grabar un video corto el 11/11. Las empresas y los puestos son
 * ficticios; los puntajes y los motivos están escritos a mano para que se lean como los reales.
 */
export type DemoOffer = {
  id: string;
  title: string;
  company: string;
  place: string;
  date: string;
  source: string;
  score: number;
  action: "aplicar" | "aplicar_personalizado" | "guardar" | "descartar";
  points: FitPoints;
  /** Riesgos que se ven pero no frenan (sueldo sin publicar, ubicación sin confirmar). */
  risks: string[];
  /** Una frase de por qué, para la fila de «Hoy». */
  why: string;
};

export const DEMO_PERSON = {
  name: "Lucía",
  career: "Contaduría",
  summary:
    "Contadora pública recibida, 2 años en un estudio contable: liquidación de impuestos, balances y conciliaciones. Excel avanzado, inglés básico. Busca en Salta o remoto.",
  skills: [
    "Liquidación de impuestos",
    "Balances",
    "Conciliación bancaria",
    "Excel avanzado",
    "Tango Gestión",
  ],
} as const;

export const DEMO_OFFERS: readonly DemoOffer[] = [
  {
    id: "analista-contable",
    title: "Analista contable semi senior",
    company: "Estudio Cardón",
    place: "Salta · híbrido",
    date: "28 oct",
    source: "Computrabajo (email)",
    score: 8.5,
    action: "aplicar",
    why: "Coincide con tu experiencia en liquidación de impuestos y balances.",
    risks: [],
    points: {
      favor: [
        { kind: "cumple", text: "Pide 2 años en estudio contable: tenés 2." },
        { kind: "match", text: "Liquidación de IVA y Ganancias, que hacés hoy." },
        { kind: "match", text: "Excel avanzado." },
      ],
      falta: [{ kind: "ojo", text: "Dice «deseable Tango Gestión»: lo tenés en nivel básico." }],
    },
  },
  {
    id: "auxiliar-impuestos",
    title: "Auxiliar de impuestos",
    company: "Contadores del Norte",
    place: "Remoto (Argentina)",
    date: "27 oct",
    source: "LinkedIn (email)",
    score: 7.5,
    action: "aplicar",
    why: "Remoto en Argentina y con tareas que ya hacés.",
    risks: ["Sueldo no publicado"],
    points: {
      favor: [
        { kind: "cumple", text: "Remoto para Argentina, como buscás." },
        { kind: "match", text: "Presentaciones en AFIP y conciliaciones." },
      ],
      falta: [{ kind: "sin_dato", text: "No publica el sueldo." }],
    },
  },
  {
    id: "analista-costos",
    title: "Analista de costos",
    company: "Distribuidora Quebrada",
    place: "Jujuy · presencial",
    date: "26 oct",
    source: "Indeed (email)",
    score: 5.5,
    action: "guardar",
    why: "Te falta experiencia en costos industriales.",
    risks: ["Ubicación: pide vivir en Jujuy"],
    points: {
      favor: [{ kind: "match", text: "Excel avanzado y armado de reportes." }],
      falta: [
        { kind: "falta", text: "Experiencia en costos industriales (pide 3 años)." },
        { kind: "ojo", text: "Es presencial en Jujuy y vos buscás en Salta o remoto." },
      ],
    },
  },
  {
    id: "controller-bilingue",
    title: "Controller bilingüe",
    company: "Grupo Valle Alto",
    place: "Buenos Aires · presencial",
    date: "25 oct",
    source: "Get on Board",
    score: 3,
    action: "descartar",
    why: "Pide inglés avanzado y 5 años de experiencia.",
    risks: [],
    points: {
      favor: [{ kind: "match", text: "Balances y cierres mensuales." }],
      falta: [
        { kind: "frena", text: "Inglés avanzado para reportar a casa matriz: tenés básico." },
        { kind: "falta", text: "Pide 5 años de experiencia: tenés 2." },
      ],
    },
  },
];

/** La oferta que llegó por email sin el texto del aviso: se muestra cómo completarla. */
export const DEMO_PENDING = {
  title: "Asistente contable",
  company: "Mutual del Cerro",
  place: "Salta",
  date: "29 oct",
  source: "Computrabajo (email)",
} as const;
