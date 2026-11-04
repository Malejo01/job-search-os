import { initials } from "@job-search-os/pipeline";
import Link from "next/link";
import { Icon } from "@/components/ui";

/**
 * Avatar de la barra (C7-5; C10-3, `.av` del tablero aprobado el 4/11): círculo índigo vivo con las
 * iniciales en blanco 800, 40 px en la computadora y 34 en el celular. Lleva a «Tu perfil». Sin
 * nombre, el ícono de perfil. Server Component.
 */
export function Avatar({ name }: { name: string | null }) {
  const letters = name ? initials(name) : null;
  return (
    <Link
      href="/settings/perfil"
      aria-label={name ? `Perfil de ${name}${letters ? ` (${letters})` : ""}` : "Perfil"}
      className="-my-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span
        aria-hidden="true"
        className="flex size-[34px] items-center justify-center rounded-pill bg-ink-accent text-sm font-extrabold text-on-ink sm:size-10 sm:text-base"
      >
        {letters ?? <Icon name="perfil" size={20} />}
      </span>
    </Link>
  );
}
