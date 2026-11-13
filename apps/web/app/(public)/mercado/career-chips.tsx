import { ROLE_KEYS } from "@job-search-os/pipeline";
import Link from "next/link";
import { betaFirst, catalogLabel } from "@/lib/career-names";
import { getPublicCareerKeys } from "@/lib/career-visibility";

/**
 * Links a cada carrera (ronda 63): /mercado/<carrera> o /ofertas/<carrera>. Son rutas, no filtros
 * por query, para que cada página sea ISR. La carrera actual va marcada con `aria-current`.
 *
 * Sin prefetch (ronda 85): con 13 chips en pantalla, cada visita generaba las 13 páginas ISR en el
 * servidor (CPU de Vercel), y después de un deploy con el pool vacío dejaba carreras vacías en el
 * caché por 30 minutos. El link carga al tocarlo.
 *
 * Las carreras que se muestran salen de `getPublicCareerKeys()` (ADR-029): las de la beta aparecen solas al
 * llegar a 10 ofertas. La carrera actual se muestra aunque esté oculta.
 */
export async function CareerChips({
  base,
  current,
  label,
}: {
  base: "/mercado" | "/ofertas";
  current?: string;
  label: string;
}) {
  const visible = await getPublicCareerKeys();
  // R5-C8: las 8 carreras de la beta primero y con su nombre; el resto, después
  const { beta, others } = betaFirst(ROLE_KEYS.filter((k) => visible.includes(k) || k === current));
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {[...beta, ...others].map((key) => (
          <li key={key}>
            <Link
              href={`${base}/${key}`}
              prefetch={false}
              aria-current={key === current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                key === current
                  ? "border-brand-contrast bg-brand text-brand-contrast"
                  : "border-line-strong bg-surface text-fg hover:bg-surface-muted"
              }`}
            >
              {catalogLabel(key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
