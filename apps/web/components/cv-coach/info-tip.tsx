/**
 * «ⓘ» con una explicación corta (R33-06, C-38). `<details>` nativo: se abre con Enter o espacio, lo anuncia
 * el lector de pantalla y no necesita JS. Server Component. El texto va visible al abrir, nunca solo en un
 * `title` (que no se ve con el teclado ni en el celular).
 */
export function InfoTip({
  term,
  children,
  testId,
}: {
  /** Lo que se explica, para el nombre accesible: «Qué mide: Estructura». */
  term: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <details className="relative inline-block text-sm" data-testid={testId}>
      <summary className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-pill text-link hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-base leading-none font-bold">
          ⓘ
        </span>
        <span className="sr-only">Qué mide: {term}</span>
      </summary>
      <div
        role="region"
        aria-label={term}
        className="absolute top-full left-0 z-20 mt-1 w-64 max-w-[85vw] rounded-card border-2 border-line-strong bg-surface p-3 text-sm font-normal text-fg shadow-lg"
      >
        {children}
      </div>
    </details>
  );
}
