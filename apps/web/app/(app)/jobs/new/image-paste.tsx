"use client";

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PICK_BYTES,
  MAX_IMAGE_SIDE_PX,
  offerToJobDefaults,
  type ImageOffer,
} from "@job-search-os/pipeline";
import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/app/components/submit-button";
import { alertClasses, buttonClasses, cardClasses } from "@/components/ui";
import { createJobsFromImageAction, readJobImageAction, type ImageReadState } from "./actions";
import { JobFields } from "./job-fields";

const PANEL = cardClasses({ padding: "md", className: "flex flex-col gap-4" });
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

type ReadError =
  Extract<ImageReadState, { status: "error" }>["code"] | "tipo" | "pesada" | "lectura";

/** Textos para la persona; la URL y los logs llevan solo el código. */
const ERROR_TEXT: Record<ReadError, string> = {
  tipo: "Esa imagen no se puede usar: tiene que ser PNG, JPG o WebP.",
  pesada: "La imagen pesa más de 5 MB. Probá con una captura más chica.",
  lectura: "No se pudo preparar la imagen en tu navegador. Probá con otra captura.",
  sesion: "Tu sesión venció. Volvé a entrar y probá de nuevo.",
  imagen_vacia: "La imagen está vacía. Probá con otra.",
  imagen_grande: "La imagen reducida sigue siendo muy pesada. Probá con una captura más chica.",
  imagen_formato: "No se pudo leer el formato de la imagen. Probá con un PNG, JPG o WebP.",
  limite_imagenes:
    "Llegaste al máximo de 10 imágenes por día. Podés cargar la oferta pegando el texto.",
  tope_user: "Llegaste al tope de uso del modelo por hoy. Probá mañana o pegá el texto del aviso.",
  tope_global:
    "El modelo llegó a su tope de uso por hoy. Probá más tarde o pegá el texto del aviso.",
  modelo: "No pudimos leer la imagen. Probá con otra captura o pegá el texto del aviso.",
  no_es_aviso: "La imagen no parece un aviso de empleo. Probá con otra o pegá el texto.",
  salida_invalida:
    "No pudimos leer el aviso con seguridad. Probá con otra captura o pegá el texto del aviso.",
};

/** Decodifica la imagen en el navegador y la reduce: lado máximo 1600 px, JPEG, bajo el tope de la acción. */
async function reduceImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, MAX_IMAGE_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    for (let round = 0; round < 6; round++) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      // JPEG no tiene transparencia: sobre fondo blanco, no negro
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", quality),
        );
        if (!blob) throw new Error("toBlob");
        if (blob.size <= MAX_IMAGE_BYTES) return blob;
      }
      scale *= 0.75;
    }
    throw new Error("demasiado grande");
  } finally {
    bitmap.close();
  }
}

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; step: "preparando" | "leyendo" }
  | { kind: "review"; offers: ImageOffer[] };

/**
 * «Cargar desde una imagen» (R6-3), dentro del modo pegar: Ctrl+V, arrastrar o elegir un PNG, JPG o
 * WebP de hasta 5 MB. El navegador la reduce (canvas, JPEG, 1600 px) y la acción de servidor la lee.
 * La imagen no se guarda en ningún lado: solo viaja a la acción y se descarta. Lo leído es una
 * propuesta que la persona revisa, edita y tilda antes de crear nada.
 */
export function ImagePaste() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<ReadError | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const busy = phase.kind === "busy";

  async function handle(file: File) {
    setError(null);
    if (!ACCEPTED.includes(file.type)) return setError("tipo");
    if (file.size > MAX_IMAGE_PICK_BYTES) return setError("pesada");
    setPhase({ kind: "busy", step: "preparando" });
    let blob: Blob;
    try {
      blob = await reduceImage(file);
    } catch {
      setPhase({ kind: "idle" });
      return setError("lectura");
    }
    setPhase({ kind: "busy", step: "leyendo" });
    const body = new FormData();
    body.set("image", blob, "aviso.jpg");
    try {
      const res = await readJobImageAction(body);
      if (res.status === "ok") setPhase({ kind: "review", offers: res.offers });
      else {
        setPhase({ kind: "idle" });
        setError(res.code);
      }
    } catch {
      setPhase({ kind: "idle" });
      setError("modelo");
    }
  }

  // Ctrl+V en cualquier parte de la pantalla: solo se toma si lo pegado es una imagen; el texto
  // pegado en el cuadro de arriba sigue su camino
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void handleRef.current(file);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (phase.kind === "review") statusRef.current?.focus();
  }, [phase.kind]);

  if (phase.kind === "review") {
    return (
      <ImageReview
        offers={phase.offers}
        statusRef={statusRef}
        onBack={() => setPhase({ kind: "idle" })}
      />
    );
  }

  return (
    <div
      className={`${PANEL} ${dragging ? "border-line-ink" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && !busy) void handle(file);
      }}
    >
      <h2 className="text-base font-semibold">O cargala desde una captura</h2>
      <p id="imagen-ayuda" className="text-sm text-fg-subtle">
        Pegá la imagen con Ctrl+V, arrastrala acá o elegí un archivo (PNG, JPG o WebP, hasta 5 MB).
        La reducimos en tu navegador, la leemos con un modelo y la descartamos: no se guarda. Revisá
        los datos antes de cargar.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          aria-describedby="imagen-ayuda"
          onClick={() => inputRef.current?.click()}
          className={buttonClasses({ variant: "secondary" })}
        >
          Elegir imagen
        </button>
        <input
          ref={inputRef}
          type="file"
          name="imagen-aviso"
          accept={ACCEPTED.join(",")}
          aria-label="Imagen del aviso"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handle(file);
          }}
        />
        {busy ? (
          <p role="status" className="text-sm text-fg-subtle">
            {phase.step === "preparando" ? "Preparando la imagen…" : "Leyendo el aviso…"}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={alertClasses({ tone: "danger" })}>
          {ERROR_TEXT[error]}
        </p>
      ) : null}
    </div>
  );
}

function ImageReview({
  offers,
  statusRef,
  onBack,
}: {
  offers: ImageOffer[];
  statusRef: React.RefObject<HTMLParagraphElement | null>;
  onBack: () => void;
}) {
  const [checked, setChecked] = useState<boolean[]>(() => offers.map(() => true));
  const selected = checked.filter(Boolean).length;
  return (
    <form action={createJobsFromImageAction} className={PANEL}>
      <p ref={statusRef} role="status" tabIndex={-1} className={alertClasses({ tone: "warning" })}>
        Leímos {offers.length === 1 ? "1 oferta" : `${offers.length} ofertas`} en la imagen. Revisá
        los datos
        {offers.length > 1 ? " y tildá las que querés cargar" : ""}: lo que la imagen no decía quedó
        vacío.
      </p>
      {offers.map((offer, i) => {
        const extras = [
          ["Sueldo", offer.salary],
          ["Países permitidos", offer.countriesAllowed?.join(", ") ?? null],
          ["Requisitos", offer.requirements?.join("; ") ?? null],
          ["Cómo postularse", offer.howToApply],
        ] as const;
        return (
          <fieldset key={i} className="flex flex-col gap-4 rounded-card border border-line p-4">
            <legend className="px-1 text-sm font-semibold">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={`o${i}.include`}
                  checked={checked[i]}
                  onChange={(e) =>
                    setChecked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))
                  }
                />
                {offers.length > 1 ? `Cargar la oferta ${i + 1}` : "Cargar esta oferta"}
              </label>
            </legend>
            <dl className="grid gap-1 text-xs text-fg-subtle">
              {extras.map(([label, value]) => (
                <div key={label} className="flex gap-1">
                  <dt className="font-medium">{label}:</dt>
                  <dd>{value ?? "la imagen no lo dice"}</dd>
                </div>
              ))}
            </dl>
            <JobFields
              defaults={offerToJobDefaults(offer)}
              namePrefix={`o${i}.`}
              required={checked[i]}
              withSubmit={false}
              submitLabel=""
              pendingLabel=""
            />
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onBack} className={buttonClasses({ variant: "secondary" })}>
          Descartar y probar con otra imagen
        </button>
        <SubmitButton pendingLabel="Cargando…" className={buttonClasses()}>
          {selected === 1
            ? "Cargar la oferta elegida"
            : selected === 0
              ? "Cargar las ofertas elegidas"
              : `Cargar las ${selected} ofertas elegidas`}
        </SubmitButton>
      </div>
    </form>
  );
}
