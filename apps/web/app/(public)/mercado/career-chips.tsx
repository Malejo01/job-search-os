import { ROLE_KEYS } from "@job-search-os/pipeline";
import Link from "next/link";
import { careerLabel } from "@/lib/career-market";

/**
 * Links a cada carrera (ronda 63): /mercado/<carrera> o /ofertas/<carrera>. Son rutas, no filtros
 * por query, para que cada página sea ISR. La carrera actual va marcada con `aria-current`.
 *
 * Sin prefetch (ronda 85): con 13 chips en pantalla, cada visita generaba las 13 páginas ISR en el
 * servidor (CPU de Vercel), y después de un deploy con el pool vacío dejaba carreras vacías en el
 * caché por 30 minutos. El link carga al tocarlo.
 */
export function CareerChips({
  base,
  current,
  label,
}: {
  base: "/mercado" | "/ofertas";
  current?: string;
  label: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {ROLE_KEYS.map((key) => (
          <li key={key}>
            <Link
              href={`${base}/${key}`}
              prefetch={false}
              aria-current={key === current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm ${
                key === current
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
              }`}
            >
              {careerLabel(key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
