/**
 * Ayuda "¿Qué es CEFR?" compartida por el formulario del onboarding y la pantalla de skills.
 * Server Component: un `<details>` nativo, sin estado.
 */
export function CefrHelp({ className = "" }: { className?: string }) {
  return (
    <details className={`rounded-md border border-zinc-200 p-3 text-sm ${className}`.trim()}>
      <summary className="min-h-11 cursor-pointer font-medium">¿Qué es CEFR?</summary>
      <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-zinc-700">
        <li>
          <span className="font-medium">A1–A2 · básico:</span> entendés frases y textos cortos.
        </li>
        <li>
          <span className="font-medium">B1 · intermedio:</span> leés documentación y escribís mails
          simples; seguir una reunión en inglés te cuesta.
        </li>
        <li>
          <span className="font-medium">B2 · intermedio alto:</span> participás en reuniones y
          entrevistas con algunos errores.
        </li>
        <li>
          <span className="font-medium">C1 · avanzado:</span> trabajás todo el día en inglés sin
          problema.
        </li>
        <li>
          <span className="font-medium">C2 · casi nativo.</span>
        </li>
      </ul>
    </details>
  );
}
