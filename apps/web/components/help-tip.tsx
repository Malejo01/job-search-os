import { AYUDA_EN_CONTEXTO, type AyudaClave } from "@job-search-os/pipeline";
import { cx } from "@/components/ui";

/** Ayuda en contexto (C8-6): apagada salvo `HELP_TIPS_ENABLED=1`. */
export function helpTipsEnabled(): boolean {
  return process.env.HELP_TIPS_ENABLED === "1";
}

/**
 * «¿Qué es esto?» (C8-6): una explicación corta en lenguaje llano que se abre en el lugar. Server
 * Component sin JS: `<details>` nativo, accesible con teclado y lector de pantalla. Los textos viven en
 * `packages/pipeline/src/help/ayuda-en-contexto.ts` (los edita Ani).
 */
export function HelpTip({ topic, className }: { topic: AyudaClave; className?: string }) {
  if (!helpTipsEnabled()) return null;
  const { tema, parrafos } = AYUDA_EN_CONTEXTO[topic];
  return (
    <details data-testid={`ayuda-${topic}`} className={cx("group text-sm", className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-pill border-2 border-current text-xs leading-none"
        >
          ?
        </span>
        ¿Qué es esto?<span className="sr-only"> {tema}</span>
      </summary>
      <div className="mt-1 flex flex-col gap-2 rounded-card bg-surface-subtle p-3 text-fg-muted">
        {parrafos.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </details>
  );
}
