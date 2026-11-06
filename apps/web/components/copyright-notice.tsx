import { COPYRIGHT_NOTICE } from "@job-search-os/pipeline";

/**
 * Aviso de derechos reservados del pie (ticket «derechos reservados»). Server Component: el texto sale
 * de `COPYRIGHT_NOTICE` (`brand.ts`), así el nombre y el año no se escriben a mano en cada pie.
 * El aviso está en español también en el pie en inglés, por eso lleva `lang="es"`.
 */
export function CopyrightNotice({ className }: { className?: string }) {
  return (
    <p lang="es" data-testid="copyright-notice" className={className}>
      {COPYRIGHT_NOTICE}
    </p>
  );
}
