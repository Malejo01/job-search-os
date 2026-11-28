/**
 * Textos de «Preparar mi postulación» (R30-10) que viajan al navegador: viven acá, en un archivo
 * chico, para no sumar `textos-rediseno.ts` entero al First Load. `DETALLE_TEXTOS.postular` los
 * reexporta, así que la revisión de textos los ve en el mismo lugar.
 */
export const POSTULAR_CLIENTE = {
  /** Botón de salida único. `{sitio}` es el dominio del aviso (sin «www.»). */
  irA: "Ir a postularme en {sitio} ↗",
  irASinSitio: "Ir a postularme ↗",
  verOferta: "Ver oferta ↗",
  otraPestana: " (se abre en otra pestaña)",
  // Pregunta al volver: nada se marca solo
  preguntaTitulo: "¿Pudiste postularte?",
  preguntaAyuda: "Lo marcamos por lo que digas: la app no puede verlo en el sitio de la empresa.",
  preguntaSi: "Sí",
  preguntaNo: "No",
} as const;
