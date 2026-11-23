import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { textLinkClasses } from "@/components/ui";
import { requireActiveUserId } from "@/lib/session";
import { loadSession } from "../server";
import type { RetrySource } from "./retry-button";
import { Simulator, type AnswerView } from "./simulator";

export const metadata = { title: "Simulación de entrevista" };
export const dynamic = "force-dynamic";

/**
 * Una simulación. Server Component: carga la simulación de la persona (RLS) y deja la parte interactiva en
 * el cliente. Una simulación ajena o inexistente da 404, igual que una página que no existe.
 */
export default async function InterviewSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const userId = await requireActiveUserId();
  const loaded = await loadSession(userId, id);
  if (!loaded) notFound();

  const answers: AnswerView[] = loaded.answers.map((a) => ({
    position: a.position,
    answer: a.answer,
    clarity: a.clarity,
    relevance: a.relevance,
    star: a.star,
    tip: a.tip,
    example: a.example,
  }));

  const { session } = loaded;
  const source: RetrySource =
    session.sourceKind === "job" && session.jobId
      ? { kind: "job", jobId: session.jobId }
      : {
          kind: "career",
          career: session.career ?? session.title,
          seniority: session.seniority ?? "junior",
        };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/interview" className={textLinkClasses({ block: true })}>
          ← Interview
        </Link>
        <h1 className="text-title font-bold">Simulación de entrevista</h1>
      </div>
      <Simulator
        sessionId={loaded.session.id}
        title={loaded.session.title}
        questions={loaded.session.questions}
        initialAnswers={answers}
        source={source}
      />
    </div>
  );
}
