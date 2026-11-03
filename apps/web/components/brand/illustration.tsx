import {
  ILLUSTRATION_SIZE,
  ILLUSTRATIONS,
  illustrationSrc,
  type IllustrationScene,
} from "@job-search-os/pipeline";
import { cx } from "@/components/ui/cx";
import { Monogram } from "./logo";

/**
 * Ilustración de una escena (C9-12, decisión 15). Server Component, sin JS ni animación.
 *
 * - Busca la imagen en el manifiesto (`ILLUSTRATIONS` de pipeline): `public/ilustraciones/<escena>`
 *   en 1x y @2x (`srcSet`), 4:3.
 * - Las de fondo lavanda van dentro de un recuadro lavanda de radio 32, igual en claro y en
 *   oscuro; las de fondo índigo (`hoy`, `acceso`) van directo sobre la cabecera índigo.
 * - Si la escena todavía no tiene imagen, muestra el marcador: el recuadro lavanda con el monograma,
 *   del mismo tamaño, así la pantalla no salta cuando llegue.
 * - Son decorativas (el texto de al lado dice lo que pasa): `alt=""`. Con `alt` se puede dar una
 *   descripción si alguna vez una dice algo propio.
 *
 * El ancho lo pone quien la usa (`className="w-40 sm:w-56"`); el alto sale de la proporción.
 */
export function Illustration({
  escena,
  alt = "",
  className,
  priority = false,
}: {
  escena: IllustrationScene;
  alt?: string;
  className?: string;
  /** Arriba de la pantalla (cabecera): sin carga diferida. */
  priority?: boolean;
}) {
  const info = ILLUSTRATIONS[escena];
  const framed = !info.available || info.background === "lavanda";
  return (
    <div
      data-ilustracion={escena}
      data-ilustracion-estado={info.available ? "lista" : "marcador"}
      aria-hidden={alt ? undefined : true}
      className={cx(
        "relative aspect-[4/3] shrink-0 overflow-hidden",
        framed && "rounded-container bg-illustration",
        className,
      )}
    >
      {info.available ? (
        // Imagen estática del mismo dominio, ya en webp y en dos tamaños: sin el optimizador
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...illustrationSrc(escena)}
          width={ILLUSTRATION_SIZE.width}
          height={ILLUSTRATION_SIZE.height}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Monogram size={56} tone="light" className="opacity-40" />
        </div>
      )}
    </div>
  );
}
