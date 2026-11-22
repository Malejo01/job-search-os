import { describe, expect, it } from "vitest";
import {
  createDictation,
  errorCodeOf,
  getSpeechRecognition,
  joinDictated,
  type SpeechEventLike,
  type SpeechRecognitionLike,
} from "./dictar-engine";

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  started = 0;
  stopped = 0;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
    this.onend?.();
  }
  say(parts: { t: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.t }], { isFinal: p.final }));
    this.onresult?.({
      results: Object.assign(results, { length: results.length }),
    } as unknown as SpeechEventLike);
  }
}

function setup(base = "", maxLength?: number) {
  const texts: string[] = [];
  const states: boolean[] = [];
  const errors: string[] = [];
  const d = createDictation({
    Ctor: FakeRecognition,
    getBase: () => base,
    onText: (t) => texts.push(t),
    onListening: (l) => states.push(l),
    onError: (c) => errors.push(c),
    maxLength,
  });
  return { d, texts, states, errors };
}

describe("getSpeechRecognition", () => {
  it("sin soporte devuelve null (el botón no se muestra)", () => {
    expect(getSpeechRecognition({})).toBeNull();
    expect(getSpeechRecognition(undefined)).toBeNull();
    expect(getSpeechRecognition({ SpeechRecognition: "no es función" })).toBeNull();
  });
  it("detecta SpeechRecognition y la variante con prefijo", () => {
    expect(getSpeechRecognition({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(getSpeechRecognition({ webkitSpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
  });
});

describe("joinDictated", () => {
  it("une con un solo espacio y no agrega nada si no se dijo nada", () => {
    expect(joinDictated("Hola", "mundo")).toBe("Hola mundo");
    expect(joinDictated("Hola  ", " mundo ")).toBe("Hola mundo");
    expect(joinDictated("", "mundo")).toBe("mundo");
    expect(joinDictated("Hola", "  ")).toBe("Hola");
  });
});

describe("createDictation", () => {
  it("configura es-AR, resultados intermedios y escucha continua", () => {
    const { d, states } = setup();
    d.start();
    const r = FakeRecognition.last!;
    expect(r.lang).toBe("es-AR");
    expect(r.interimResults).toBe(true);
    expect(r.continuous).toBe(true);
    expect(r.started).toBe(1);
    expect(states).toEqual([true]);
  });

  it("el texto intermedio llega en vivo y se agrega a lo ya escrito", () => {
    const { d, texts } = setup("Trabajé en");
    d.start();
    const r = FakeRecognition.last!;
    r.say([{ t: "una empresa", final: false }]);
    r.say([
      { t: "una empresa de logística", final: true },
      { t: " en Córdoba", final: false },
    ]);
    expect(texts).toEqual([
      "Trabajé en una empresa",
      "Trabajé en una empresa de logística en Córdoba",
    ]);
  });

  it("respeta el tope de caracteres", () => {
    const { d, texts } = setup("", 10);
    d.start();
    FakeRecognition.last!.say([{ t: "una frase bastante larga", final: true }]);
    expect(texts[0]).toHaveLength(10);
  });

  it("stop corta y avisa que dejó de escuchar; un segundo start vuelve a empezar", () => {
    const { d, states } = setup();
    d.start();
    d.start(); // ya escuchando: no abre otro
    expect(FakeRecognition.last!.started).toBe(1);
    d.stop();
    expect(states).toEqual([true, false]);
    expect(d.listening).toBe(false);
    d.start();
    expect(states).toEqual([true, false, true]);
  });

  it("cancel descarta lo que falte llegar", () => {
    const { d, texts } = setup();
    d.start();
    const r = FakeRecognition.last!;
    d.cancel();
    r.say([{ t: "tarde", final: true }]);
    expect(texts).toEqual([]);
    expect(d.listening).toBe(false);
  });

  it("traduce los errores del navegador a códigos propios", () => {
    expect(errorCodeOf("not-allowed")).toBe("denied");
    expect(errorCodeOf("no-speech")).toBe("no-speech");
    expect(errorCodeOf("network")).toBe("unavailable");
    expect(errorCodeOf("raro")).toBe("other");
    const { d, errors } = setup();
    d.start();
    FakeRecognition.last!.onerror?.({ error: "not-allowed" });
    expect(errors).toEqual(["denied"]);
  });

  it("si start falla, no queda escuchando y avisa", () => {
    class Broken extends FakeRecognition {
      override start() {
        throw new Error("ya iniciado");
      }
    }
    const errors: string[] = [];
    const states: boolean[] = [];
    const d = createDictation({
      Ctor: Broken,
      getBase: () => "",
      onText: () => {},
      onListening: (l) => states.push(l),
      onError: (c) => errors.push(c),
    });
    d.start();
    expect(errors).toEqual(["unavailable"]);
    expect(states).toEqual([]);
    expect(d.listening).toBe(false);
  });
});
