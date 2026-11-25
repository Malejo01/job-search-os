import Link from "next/link";
import { Afi } from "@/components/afi";
import { AfiAnimadoLazy } from "@/components/afi-animado-lazy";
import { buttonClasses } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import type { MascotaPose } from "@/lib/mascota";

/**
 * Afi que habla (R28-15). Server Component: Afi de 96 px en el celular y 128 px en la computadora, y al lado una
 * burbuja de diálogo con colita (CSS, sin SVG) con el texto en primera persona y, si hace falta, un botón.
 *
 * - En el celular Afi va arriba y la burbuja abajo (la colita apunta hacia arriba); desde `sm`, Afi a la
 *   izquierda y la burbuja al lado (la colita apunta hacia Afi). Sin ancho fijo: no genera scroll horizontal.
 * - La imagen es `decorative` (el texto dice lo importante): el contenido es el `<p>` de la burbuja.
 * - `animar`: solo para la entrada `saludando` de Hoy la primera vez del día. Usa `AfiAnimadoLazy` (la
 *   animación llega aparte, sin sumar Framer Motion al First Load). En todos los demás casos, `<Afi>` estático.
 * - Un solo Afi por pantalla: quien pone `AfiDice` saca cualquier otro Afi de esa pantalla.
 *
 * La imagen se dibuja siempre a 128 px y, en el celular, se reduce a 96 px con `scale` del contenedor: así no
 * hay dos imágenes ni medidas distintas en el servidor y en el navegador.
 */
export function AfiDice({
  pose,
  texto,
  accion,
  animar = false,
  priority = false,
  className,
  testId = "afi-dice",
}: {
  pose: MascotaPose;
  /** Lo que dice Afi: 1 o 2 líneas, voseo, primera persona. */
  texto: string;
  /** Botón opcional dentro de la burbuja. */
  accion?: { label: string; href: string };
  animar?: boolean;
  priority?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cx(
        "flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="size-24 shrink-0 sm:size-32">
        <div className="size-32 origin-top-left scale-75 sm:scale-100">
          {animar ? (
            <AfiAnimadoLazy
              pose={pose}
              size={128}
              variante="entrada"
              decorative
              priority={priority}
            />
          ) : (
            <Afi pose={pose} size={128} decorative priority={priority} />
          )}
        </div>
      </div>
      <div
        data-testid={`${testId}-burbuja`}
        className="relative min-w-0 max-w-full rounded-card border border-line-strong bg-surface px-4 py-3 text-fg sm:max-w-xl"
      >
        <span
          aria-hidden="true"
          className="absolute -top-1.5 left-10 size-3 rotate-45 border-t border-l border-line-strong bg-surface sm:top-1/2 sm:-left-1.5 sm:-mt-1.5"
        />
        <p data-testid={`${testId}-texto`} className="text-base leading-snug font-semibold">
          {texto}
        </p>
        {accion ? (
          <Link
            href={accion.href}
            className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-2" })}
          >
            {accion.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
