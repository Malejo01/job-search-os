import { BETA_LAUNCH_ROLE_KEYS, type RoleKey } from "@job-search-os/pipeline";
import { ROLE_SKILLS } from "@/lib/skill-levels";

/**
 * Nombres de las 8 carreras de la beta tal como se anuncian (R5-C8). Los catálogos, selectores y
 * filtros muestran este nombre; el resto de las carreras conserva su etiqueta de `role_skills.json`.
 * Es solo texto de pantalla: la clave y los datos no cambian.
 */
const BETA_NAMES: Partial<Record<RoleKey, string>> = {
  abogacia: "Abogacía",
  finanzas_contabilidad: "Contaduría",
  administracion_empresas: "Administración",
  comunicacion: "Comunicación",
  marketing_digital: "Marketing",
  relaciones_publicas: "Relaciones públicas",
  relaciones_internacionales: "Relaciones internacionales y comex",
  fullstack: "Programación",
};

/** Nombre de la carrera para un catálogo: el de la beta si es una de las 8, si no su etiqueta. */
export function catalogLabel(key: RoleKey): string {
  return BETA_NAMES[key] ?? ROLE_SKILLS[key].label;
}

/**
 * Claves en el orden de un catálogo plano: las 8 de la beta primero (orden del anuncio) y después el
 * resto, en el orden que traían. Solo muestra las de `keys`.
 */
export function betaFirst(keys: readonly RoleKey[]): { beta: RoleKey[]; others: RoleKey[] } {
  return {
    beta: BETA_LAUNCH_ROLE_KEYS.filter((k) => keys.includes(k)),
    others: keys.filter((k) => !BETA_LAUNCH_ROLE_KEYS.includes(k)),
  };
}
