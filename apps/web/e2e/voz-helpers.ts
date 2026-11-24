import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, ownerDb } from "./helpers";

/**
 * Apoyo de los flujos 220-229 (R25-06, voz). Micrófono falso de Chromium, navegadores simulados, una simulación
 * de Interview inventada y el cupo diario. Todo con la persona B (o una propia inventada): la base local no
 * tiene usuario seed. Nada llama a un modelo: el servidor de e2e corre con `LLM_DEMO=1`.
 */

/** `test.use` de los specs que usan el micrófono: acepta el cartel solo y da un dispositivo con un tono. */
export const FAKE_MIC = {
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
};

/**
 * Micrófono falso con un tono CONTINUO (un seno de 440 Hz en un WAV inventado que se escribe en la carpeta
 * temporal). El dispositivo falso por defecto suena en bips: el componente mira el nivel cada 250 ms y, según la
 * fase del bip, puede no ver señal nunca (flujo 226). Con el archivo la señal es siempre la misma.
 */
export function fakeMicWithTone(): typeof FAKE_MIC {
  const rate = 16_000;
  const samples = rate; // 1 s; el dispositivo falso repite el archivo
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const file = join(tmpdir(), "e2e-voz-tono-440.wav");
  writeFileSync(file, Buffer.concat([header, data]));
  return {
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${file}`,
      ],
    },
    permissions: ["microphone"],
  };
}

/** El servidor de e2e corre con `VOICE_SERVER_TRANSCRIBE=testers` (playwright.config.ts) y B es tester. */
export const SERVER_MODE_ON = process.env.E2E_VOICE_SERVER_MODE === "testers";

export const OPERA_GX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0";

/** Texto fijo del fake de transcripción para una grabación de hasta 5 s (`demo-voice.ts`, R25-03). */
export const FAKE_TRANSCRIPTION_SHORT = "Trabajé tres años con SQL y Excel.";

export const SESSION_QUESTIONS = [1, 2, 3, 4, 5].map((n) => `Pregunta ficticia número ${n} de voz`);

/** Una simulación inventada de la persona: es la pantalla con el campo donde se prueba la voz. */
export async function seedInterviewSession(userId: string, title: string): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .insert(s.interviewSessions)
      .values({
        userId,
        sourceKind: "career",
        career: "Analista de datos",
        seniority: "junior",
        title,
        questions: SESSION_QUESTIONS,
      })
      .returning({ id: s.interviewSessions.id });
    return row!.id;
  } finally {
    await close();
  }
}

/** Crea a B y le arma una simulación. Devuelve el id de la simulación. */
export async function prepareB(title: string): Promise<string> {
  await ensureSecondUser();
  await cleanB();
  return seedInterviewSession(E2E_B_USER_ID, title);
}

/** Borra lo que estos flujos le dejan a B: simulaciones y llamadas de voz (también el cupo sembrado). */
export async function cleanB(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), eq(s.llmCalls.task, "transcribe_audio")));
  } finally {
    await close();
  }
}

/** Le gasta a B todo el cupo del día (1200 s por defecto) con una llamada inventada. Lo borra `cleanB`. */
export async function seedFullDailyCap(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.llmCalls).values({
      userId: E2E_B_USER_ID,
      task: "transcribe_audio",
      model: "fake",
      promptVersion: "transcribe_audio@v1",
      label: "voice:1200:seed1",
      costUsd: 0,
      latencyMs: 0,
      ok: true,
      createdAt: new Date(),
    });
  } finally {
    await close();
  }
}

export async function openInterview(page: Page, sessionId: string): Promise<void> {
  await loginAsSecondUser(page);
  await page.goto(`/interview/${sessionId}`);
  await page.getByTestId("interview-answer").waitFor();
}

/** Persona que NO es tester: el interruptor en `testers` queda apagado para ella. */
export const OFF_USER = {
  id: "c0000000-0000-4000-8000-000000000225",
  email: "usuario-voz-off@ejemplo.test",
  password: "dev-password-voz-off-local",
};

export async function ensureOffUser(): Promise<string> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: OFF_USER.id,
        email: OFF_USER.email,
        name: "Persona Voz Apagada",
        passwordHash: hashPassword(OFF_USER.password),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(s.profiles)
      .values({
        userId: OFF_USER.id,
        displayName: "Persona Voz Apagada",
        locationCountry: "AR",
        inboundAddress: "u_voz_off_225@ingest.test",
        profileSummary:
          "Perfil ficticio de la persona del flujo 225. No corresponde a nadie real y solo existe en la base local.",
      })
      .onConflictDoNothing();
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, OFF_USER.id));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: OFF_USER.id, version: 1, active: true, rules: {} as never });
    }
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, OFF_USER.id));
  } finally {
    await close();
  }
  return seedInterviewSession(OFF_USER.id, "Simulación ficticia de voz apagada");
}

export async function removeOffUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, OFF_USER.id));
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, OFF_USER.id));
    await db.delete(s.profiles).where(eq(s.profiles.userId, OFF_USER.id));
    await db.delete(s.users).where(eq(s.users.id, OFF_USER.id));
  } finally {
    await close();
  }
}

export async function loginAsOffUser(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OFF_USER.email);
  await page.getByLabel("Contraseña").fill(OFF_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/hoy**");
}

export const FAKE_TRANSCRIPTION_MEDIUM =
  "Trabajé tres años como analista de datos, armando reportes semanales con SQL y Excel para el equipo comercial.";

export type RecognitionMode = "none" | "live" | "network" | "mute";

/**
 * Reconocimiento de voz simulado, antes de que cargue la página.
 * - `none`: sin `SpeechRecognition` (como Firefox).
 * - `live`: manda un parcial a los 50 ms y el final cuando el test llama a `window.__recFinal()`.
 * - `network`: falla con `network` a los 50 ms (el servicio del navegador que no existe en Opera o Brave).
 * - `mute`: arranca y no devuelve ningún resultado.
 */
export async function installRecognition(page: Page, mode: RecognitionMode): Promise<void> {
  await page.addInitScript((m) => {
    if (m === "none") {
      Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        value: undefined,
        configurable: true,
      });
      return;
    }
    const part = (text: string, isFinal: boolean) =>
      Object.assign([{ transcript: text }], { isFinal });
    class Fake {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      start() {
        (window as unknown as { __lang: string }).__lang = this.lang;
        if (m === "mute") return; // arranca pero nunca devuelve nada: a los 4 s con señal pasa a grabación
        if (m === "network") {
          setTimeout(() => this.onerror?.({ error: "network" }), 50);
          return;
        }
        (window as unknown as { __recFinal: () => void }).__recFinal = () =>
          this.onresult?.({ results: [part("Trabajé con datos de ventas", true)] });
        setTimeout(() => this.onresult?.({ results: [part("Trabajé con datos", false)] }), 50);
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: Fake, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: Fake, configurable: true });
  }, mode);
}
