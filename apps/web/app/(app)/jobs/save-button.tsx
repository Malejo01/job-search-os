import { Button } from "@/components/ui";
import { LISTADO_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { saveJobAction, unsaveJobAction } from "./saved-actions";

const T = LISTADO_TEXTOS.guardar;

/**
 * «Guardar» / «Quitar de guardadas» (R30-03). Un formulario con la acción de servidor: anda sin JS y
 * no suma nada al First Load. «Guardada» es una marca con fecha, no un estado: no cambia dónde está la
 * oferta. El nombre accesible incluye el puesto para distinguir un botón de otro en la lista.
 */
export function SaveButton({
  jobId,
  title,
  saved,
  className,
}: {
  jobId: string;
  title: string;
  saved: boolean;
  className?: string;
}) {
  return (
    <form action={saved ? unsaveJobAction : saveJobAction} className={className}>
      <input type="hidden" name="jobId" value={jobId} />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        data-testid={saved ? "quitar-guardada" : "guardar-oferta"}
        aria-label={llenarTexto(saved ? T.quitarOferta : T.guardarOferta, { titulo: title })}
      >
        {saved ? T.quitar : T.guardar}
      </Button>
    </form>
  );
}

/** La marca «Guardada»: texto, no solo color. Va en la tarjeta y en el detalle. */
export function SavedMark({ className }: { className?: string }) {
  return (
    <span
      data-testid="marca-guardada"
      className={`inline-flex items-center rounded-pill border border-line-strong bg-surface px-2.5 py-0.5 text-xs font-bold text-fg ${className ?? ""}`}
    >
      {T.marca}
    </span>
  );
}
