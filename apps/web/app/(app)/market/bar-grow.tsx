import type { CSSProperties, ReactNode } from "react";

/**
 * Barra de mercado. C9-11 (decisión 13 de C9): ya no crece al aparecer; se dibuja quieta con su
 * ancho final. Queda como componente para no tocar a quién la usa. El ancho llega en `style`; el
 * texto de la fila ya dice el número.
 */
export function BarGrow({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
