/**
 * Ayuda "¿Qué es CEFR?" compartida por el formulario del onboarding y la pantalla de skills.
 * Server Component: un `<details>` nativo, sin estado. Compacto (texto chico, poco aire) para que
 * al abrirlo no empuje el formulario de golpe ni ocupe media pantalla a 360 px.
 */
export function CefrHelp({ className = "" }: { className?: string }) {
  return (
    <details className={`rounded-md border border-zinc-200 px-3 py-1 text-sm ${className}`.trim()}>
      <summary className="min-h-11 cursor-pointer py-2.5 font-medium">¿Qué es CEFR?</summary>
      <ul className="mb-2 flex list-none flex-col gap-1 p-0 text-xs leading-5 text-zinc-700">
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
