import type { ReactNode } from "react";
import { Afi } from "@/components/afi";
import { cx } from "@/components/ui/cx";
import type { MascotaPose } from "@/lib/mascota";

/**
 * La mascota esperando junto a un texto de carga (R27-04: «Transcribiendo…», las esperas del coach, de
 * Interview y de Match). Sin hooks, sirve en servidor y en cliente. Es decorativa: el texto ya dice lo que
 * pasa. La figura es estática; el movimiento, si lo hay, es de `<AfiAnimado>` y no más de uno por pantalla.
 */
export function AfiEspera({
  pose,
  size = 40,
  children,
  className,
  ...props
}: {
  pose: MascotaPose;
  size?: number;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)} {...props}>
      <Afi pose={pose} size={size} decorative />
      <span>{children}</span>
    </span>
  );
}
