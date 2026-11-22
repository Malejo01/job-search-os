import { cardClasses } from "@/components/ui";

export const metadata = { title: "Interview" };

/** Marcador de la sección Interview: la pantalla completa la reemplaza. Server Component. */
export default function InterviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title font-bold">Interview</h1>
      <section className={cardClasses()}>
        <p className="text-fg-muted">
          Acá vas a practicar tus entrevistas. Estamos terminando esta parte.
        </p>
      </section>
    </div>
  );
}
