/**
 * Tarjeta «Esto es lo que entendí» (C-25): modelo de datos de lo extraído, para que la UI lo muestre y la
 * persona corrija antes de confirmar. Nada se guarda sin su clic. Puro.
 */
import { cvDateRange } from "../cv-out/model";
import { cvChatHistory, type CvChatState } from "./state";

export type CvCardSectionId =
  "target" | "experience" | "education" | "certifications" | "skills" | "languages" | "links";

export interface CvCardItem {
  /** Estable dentro de la tarjeta, para que la UI corrija o quite un ítem. */
  id: string;
  heading: string;
  detail: string | null;
  bullets: string[];
}

export interface CvCardSection {
  id: CvCardSectionId;
  title: string;
  items: CvCardItem[];
}

export interface CvUnderstoodCard {
  title: "Esto es lo que entendí";
  sections: CvCardSection[];
  /** Secciones sin datos: la UI las marca como «falta» en vez de inventarlas. */
  missing: CvCardSectionId[];
  /** Trabajos que quedaron sin empresa o cargo y no se incluyen. */
  incompleteWorks: number;
}

const TITLES: Record<CvCardSectionId, string> = {
  target: "Puesto objetivo",
  experience: "Experiencia",
  education: "Estudios",
  certifications: "Certificaciones",
  skills: "Skills",
  languages: "Idiomas",
  links: "Links",
};

const KIND_TO_SECTION = {
  trabajo: "experience",
  educacion: "education",
  certificacion: "certifications",
} as const;

export function buildCvUnderstoodCard(s: CvChatState): CvUnderstoodCard {
  const sections: CvCardSection[] = [];
  const put = (id: CvCardSectionId, items: CvCardItem[]): void => {
    if (items.length > 0) sections.push({ id, title: TITLES[id], items });
  };

  put("target", s.target ? [{ id: "target", heading: s.target, detail: null, bullets: [] }] : []);

  const history = cvChatHistory(s);
  for (const kind of ["trabajo", "educacion", "certificacion"] as const) {
    put(
      KIND_TO_SECTION[kind],
      history.flatMap((h, i) =>
        h.kind === kind
          ? [
              {
                id: `history:${i}`,
                heading: h.title,
                detail:
                  [h.organization, cvDateRange(h, "es")].filter((x) => x !== "").join(" | ") ||
                  null,
                bullets: [...h.bullets],
              },
            ]
          : [],
      ),
    );
  }
  put(
    "skills",
    s.skills.length
      ? [{ id: "skills", heading: s.skills.join(", "), detail: null, bullets: [] }]
      : [],
  );
  put(
    "languages",
    s.languages.length
      ? [
          {
            id: "languages",
            heading: s.languages
              .map((l) => (l.level ? `${l.name}: ${l.level}` : l.name))
              .join(", "),
            detail: null,
            bullets: [],
          },
        ]
      : [],
  );
  const links = (
    [
      ["LinkedIn", s.links.linkedin],
      ["GitHub", s.links.github],
      ["Portfolio", s.links.portfolio],
    ] as const
  ).flatMap(([label, url]) => (url ? [`${label}: ${url}`] : []));
  put(
    "links",
    links.length ? [{ id: "links", heading: links.join(" | "), detail: null, bullets: [] }] : [],
  );

  const have = new Set(sections.map((x) => x.id));
  const required: CvCardSectionId[] = [
    "target",
    "experience",
    "education",
    "skills",
    "languages",
    "links",
  ];
  return {
    title: "Esto es lo que entendí",
    sections,
    missing: required.filter((id) => !have.has(id)),
    incompleteWorks: s.works.filter((w) => !w.organization || !w.title).length,
  };
}
