import { BRAND, COPYRIGHT_NOTICE, COPYRIGHT_YEAR } from "@job-search-os/pipeline";

/** Aviso en inglés para el pie de la vitrina `(public-en)`. */
export const COPYRIGHT_NOTICE_EN = `© ${COPYRIGHT_YEAR} ${BRAND.name}. All rights reserved.`;

/**
 * Aviso de derechos reservados del pie (ticket «derechos reservados»). Server Component: el texto sale
 * de `COPYRIGHT_NOTICE` (`brand.ts`), así el nombre y el año no se escriben a mano en cada pie.
 * Por defecto va en español; el pie en inglés pasa `locale="en"`.
 */
export function CopyrightNotice({
  className,
  locale = "es",
}: {
  className?: string;
  locale?: "es" | "en";
}) {
  return (
    <p lang={locale} data-testid="copyright-notice" className={className}>
      {locale === "en" ? COPYRIGHT_NOTICE_EN : COPYRIGHT_NOTICE}
    </p>
  );
}
