import { cx } from "@/components/ui/cx";
import {
  caraSrc,
  MASCOTA_ALT,
  mascotaAncho,
  mascotaSizes,
  mascotaSrc,
  type MascotaPose,
} from "@/lib/mascota";

/**
 * Afi, la mascota (R27-01). Server Component sin hooks: sirve también dentro de componentes de cliente.
 *
 * Una `<img>` estática (no pasa por el optimizador de imágenes de Vercel) con `srcSet` por ancho
 * y `width`/`height` fijos, así el layout no salta. El círculo lavanda (`bg-illustration`, igual en
 * claro y oscuro) es CSS: la imagen es un sticker sobre fondo transparente que puede sobresalir un
 * poco del círculo. `size` es el lado del círculo y el alto de la imagen.
 *
 * - `decorative`: hay texto al lado que dice lo mismo; `alt=""` y `aria-hidden`.
 * - `priority`: solo arriba del pliegue; carga ya y con prioridad alta. Por defecto, `lazy`.
 * - `data-afi`: la pose, para los e2e.
 */
export function Afi({
  pose,
  size = 96,
  decorative = false,
  priority = false,
  className,
}: {
  pose: MascotaPose;
  /** Lado del círculo y alto de la imagen, en px. */
  size?: number;
  decorative?: boolean;
  priority?: boolean;
  className?: string;
}) {
  return (
    <span
      data-afi={pose}
      {...(decorative ? { "aria-hidden": true } : {})}
      style={{ width: size, height: size }}
      className={cx(
        "inline-flex shrink-0 items-end justify-center rounded-full bg-illustration",
        className,
      )}
    >
      {/* Imagen estática del mismo dominio: sin el optimizador de Next */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...mascotaSrc(pose)}
        sizes={mascotaSizes(pose, size)}
        width={mascotaAncho(pose, size)}
        height={size}
        alt={decorative ? "" : MASCOTA_ALT[pose]}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        {...(priority ? { fetchPriority: "high" as const } : {})}
        draggable={false}
        className="block h-full w-auto max-w-none select-none"
      />
    </span>
  );
}

/**
 * La cara de Afi (recorte cuadrado de `quieto`) sobre el círculo lavanda: el botón del asistente.
 * `size` es el lado en px; el `srcSet` trae 48, 96, 192 y 512.
 */
export function AfiCara({
  size = 48,
  decorative = true,
  className,
}: {
  size?: number;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      data-afi="cara"
      {...(decorative ? { "aria-hidden": true } : {})}
      style={{ width: size, height: size }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-illustration",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...caraSrc()}
        sizes={`${size}px`}
        width={size}
        height={size}
        alt={decorative ? "" : MASCOTA_ALT.quieto}
        decoding="async"
        loading="lazy"
        draggable={false}
        className="block h-full w-full select-none rounded-full object-contain"
      />
    </span>
  );
}
