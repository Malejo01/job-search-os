/**
 * Afi, la mascota (R27-01). Módulo puro, sin I/O: lo leen componentes de servidor y de cliente.
 *
 * Las imágenes viven en `public/mascota/`. Cada pose tiene `<pose>-256|512|1024.webp` (el número es el
 * alto en px, fondo transparente) y `<pose>-512.png` (solo para emails). La cara del botón del
 * asistente son `cara-48|96|192|512` (`.webp` y `.png`). El círculo lavanda no está en la imagen: lo
 * pone el componente con CSS. La carpeta `favicon/` la maneja la parte de «afuera» (R27-06): no se
 * declara acá.
 *
 * El nombre vive en una sola constante, como `BRAND.name`: un test impide escribirlo a mano en la UI.
 */
export const MASCOTA_NOMBRE = "Afi";

export const MASCOTA_POSES = [
  "saludando",
  "trabajando",
  "pensando",
  "explicando",
  "quieto",
  "hablando-1",
  "hablando-2",
  "motivacion",
  "analizando",
] as const;
export type MascotaPose = (typeof MASCOTA_POSES)[number];

/** Los tres altos (px) en que existe cada pose en WebP. */
export const MASCOTA_ALTOS = [256, 512, 1024] as const;
export type MascotaAlto = (typeof MASCOTA_ALTOS)[number];

/** Ancho intrínseco (px) de cada WebP, leído de los archivos reales (un test lo verifica). */
export const MASCOTA_ANCHOS: Readonly<Record<MascotaPose, Readonly<Record<MascotaAlto, number>>>> =
  {
    saludando: { 256: 183, 512: 366, 1024: 733 },
    trabajando: { 256: 219, 512: 437, 1024: 875 },
    pensando: { 256: 137, 512: 274, 1024: 549 },
    explicando: { 256: 170, 512: 340, 1024: 679 },
    quieto: { 256: 113, 512: 226, 1024: 452 },
    "hablando-1": { 256: 169, 512: 338, 1024: 676 },
    "hablando-2": { 256: 150, 512: 300, 1024: 599 },
    motivacion: { 256: 146, 512: 293, 1024: 585 },
    analizando: { 256: 145, 512: 289, 1024: 578 },
  };

/** Para qué se usa cada pose (resumen de `docs/beta/mascota.md`). */
export const MASCOTA_USOS: Readonly<Record<MascotaPose, string>> = {
  saludando: "Hoy (primera vez del día), bienvenida, portada, email de bienvenida",
  trabajando: "Evaluando ofertas, Match vacío, lista de espera",
  pensando: "Asistente pensando, transcribiendo, cargas de IA",
  explicando: "Academy, diagnóstico del CV, ayudas «?», detalle del sello",
  quieto: "Vacíos genéricos, 404",
  "hablando-1": "Interview: la pregunta; asistente hablando",
  "hablando-2": "Interview: devolución e informe; voz",
  motivacion: "Logros: postulación enviada, CV mejorado, plan activado",
  analizando: "Tracker, Preparar mi postulación, errores «lo estamos revisando»",
};

/** `alt` descriptivo, en voseo y con el nombre sacado de la constante. */
export const MASCOTA_ALT: Readonly<Record<MascotaPose, string>> = {
  saludando: `${MASCOTA_NOMBRE} te saluda con la mano`,
  trabajando: `${MASCOTA_NOMBRE} trabaja en su laptop`,
  pensando: `${MASCOTA_NOMBRE} piensa con la mano en el mentón`,
  explicando: `${MASCOTA_NOMBRE} te explica con un gráfico holográfico`,
  quieto: `${MASCOTA_NOMBRE} te espera con su tablet y una mano en el bolsillo`,
  "hablando-1": `${MASCOTA_NOMBRE} te habla`,
  "hablando-2": `${MASCOTA_NOMBRE} te sonríe con las manos abiertas`,
  motivacion: `${MASCOTA_NOMBRE} festeja con el puño en alto`,
  analizando: `${MASCOTA_NOMBRE} analiza datos en su tablet`,
};

/** La cara del botón del asistente: cuadrada, tamaños 48, 96, 192 y 512. */
export const MASCOTA_CARAS = ["cara-48", "cara-96", "cara-192", "cara-512"] as const;
export type MascotaCara = (typeof MASCOTA_CARAS)[number];

/** Todo lo que se declara en `public/mascota/` (primer nivel): las poses y las caras. */
export type MascotaImagen = MascotaPose | MascotaCara;
export const MASCOTA_IMAGENES: readonly MascotaImagen[] = [...MASCOTA_POSES, ...MASCOTA_CARAS];

/** Nombres de archivo (sin carpeta) que tiene que haber para una imagen. */
export function mascotaArchivos(imagen: MascotaImagen): string[] {
  if ((MASCOTA_CARAS as readonly string[]).includes(imagen)) {
    return [`${imagen}.webp`, `${imagen}.png`];
  }
  return [...MASCOTA_ALTOS.map((alto) => `${imagen}-${alto}.webp`), `${imagen}-512.png`];
}

/** Ancho (px) de la pose cuando se la dibuja con `alto` px de alto (por la proporción real). */
export function mascotaAncho(pose: MascotaPose, alto: number): number {
  return Math.round((MASCOTA_ANCHOS[pose][1024] / 1024) * alto);
}

/** `src` de respaldo (el WebP de 512) y `srcSet` por ancho con los tres tamaños. */
export function mascotaSrc(pose: MascotaPose): { src: string; srcSet: string } {
  return {
    src: `/mascota/${pose}-512.webp`,
    srcSet: MASCOTA_ALTOS.map(
      (alto) => `/mascota/${pose}-${alto}.webp ${MASCOTA_ANCHOS[pose][alto]}w`,
    ).join(", "),
  };
}

/** `sizes` para una pose dibujada con `alto` px de alto: el ancho que ocupa en pantalla. */
export function mascotaSizes(pose: MascotaPose, alto: number): string {
  return `${mascotaAncho(pose, alto)}px`;
}

/** Ruta relativa del PNG de 512 px para emails (el email le antepone `APP_URL`). */
export function mascotaEmailPng(pose: MascotaPose): string {
  return `/mascota/${pose}-512.png`;
}

/** `src` y `srcSet` por ancho de la cara (48, 96, 192 y 512 px de lado). */
export function caraSrc(): { src: string; srcSet: string } {
  return {
    src: "/mascota/cara-96.webp",
    srcSet: MASCOTA_CARAS.map((c) => `/mascota/${c}.webp ${c.slice("cara-".length)}w`).join(", "),
  };
}

/** Clave del navegador con el último día que se mostró el saludo. Solo UX, sin datos personales. */
export const SALUDO_STORAGE_KEY = "afinia:mascota-saludo";

/** Día local (AAAA-MM-DD) de `d`, en la zona del navegador. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** El saludo sale una vez por día: si ya se mostró hoy, no. */
export function shouldGreetToday(stored: string | null, today: string): boolean {
  return stored !== today;
}
