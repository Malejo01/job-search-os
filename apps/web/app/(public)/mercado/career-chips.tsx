import { ROLE_KEYS } from "@job-search-os/pipeline";
import Link from "next/link";
import { careerLabel } from "@/lib/career-market";

/**
 * Links a cada carrera (ronda 63): /mercado/<carrera> o /ofertas/<carrera>. Son rutas, no filtros
 * por query, para que cada página sea ISR. La carrera actual va marcada con `aria-current`.
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
