import { Monogram } from "@/components/brand/logo";
import { cx } from "@/components/ui/cx";
import { MASCOTA_DISPONIBLE, mascotaSrc, type MascotaImagen } from "@/lib/mascota";

/**
 * Mascota del asistente (base). Lee `public/mascota/<pose>.png` (1x y 2x) y, si todavía no existe,
 * muestra un marcador neutro del mismo tamaño (como `<Illustration>`), así nada salta cuando lleguen
 * las imágenes. Sin hooks: sirve en componentes de servidor y de cliente.
 *
 * Decorativa por defecto (`aria-hidden`): el texto de al lado dice lo que pasa. Con `label` es una
 * imagen con ese nombre (por ejemplo, `MASCOT_NAME`). Con «reducir movimiento» no hay animación:
 * la de «pensando» va con `motion-safe`.
 */
export function Mascota({
  pose,
  size = 64,
  label,
  className,
}: {
  pose: MascotaImagen;
  /** Lado en px (cuadrado). */
  size?: number;
  label?: string;
  className?: string;
}) {
  const ready = MASCOTA_DISPONIBLE[pose];
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : { "aria-hidden": true };
  return (
    <span
      data-mascota={pose}
      data-mascota-estado={ready ? "lista" : "marcador"}
      {...a11y}
      style={{ width: size, height: size }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-illustration",
        pose === "pensando" && "motion-safe:animate-pulse",
        className,
      )}
    >
      {ready ? (
        // Imagen estática del mismo dominio: sin el optimizador de Next
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...mascotaSrc(pose)}
          width={size}
          height={size}
          alt=""
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        <Monogram size={Math.round(size * 0.6)} tone="light" className="opacity-40" />
      )}
    </span>
  );
}
