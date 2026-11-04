import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Check de los checklists (C10-2, `.chk` y `.chk0` del tablero aprobado): hecho, un círculo lima de
 * 26 px con «✓» índigo; pendiente, un aro de 3 px en índigo vivo. Con `children` el círculo lima
 * lleva otra cosa (el número de los pasos de la portada). Es decorativo: el estado lo dice el texto
 * de al lado («(hecho)», «(pendiente)» o el paso). Server Component; el rebote al tildarse lo pone
 * `CheckBounce` alrededor.
 */
export function CheckMark({
  done,
  children,
  className,
}: {
  done: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-check={done ? "hecho" : "pendiente"}
      className={cx(
        "flex size-[26px] shrink-0 items-center justify-center rounded-pill",
        done
          ? "bg-brand text-sm leading-none font-extrabold text-brand-contrast"
          : "border-[3px] border-brand-text",
        className,
      )}
    >
      {done ? (children ?? "✓") : null}
    </span>
  );
}
