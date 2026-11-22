import { cardClasses } from "@/components/ui";

export const metadata = { title: "Academy" };

/** Marcador de Academy: las fichas las suma el lector de contenido. Server Component. */
export default function AcademyPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title font-bold">Academy</h1>
      <section className={cardClasses()}>
        <p className="text-fg-muted">
          Todavía no hay fichas para mostrar. Pronto vas a verlas acá.
        </p>
      </section>
    </div>
  );
}
