import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Preguntas frecuentes",
  description:
    "Todo lo que necesitás saber sobre la beta cerrada: para quién es, qué hace, cuándo abre y cómo anotarte.",
  alternates: { canonical: "/ayuda" },
};

type FaqItem = {
  q: string;
  a: ReactNode;
};

const FAQS: FaqItem[] = [
  {
    q: "¿Qué es la app?",
    a: (
      <p>
        Es un asistente personal para buscar trabajo. Te ayuda a revisar avisos laborales, compara
        lo que pide cada puesto con tus conocimientos y experiencia, y te muestra en simple qué
        tenés a tu favor y qué te falta o te frena. Así ahorrás tiempo y sabés exactamente dónde te
        conviene postularte.
      </p>
    ),
  },
  {
    q: "¿Para quién es esta beta cerrada?",
    a: (
      <div className="flex flex-col gap-2">
        <p>En esta primera etapa de prueba, la app está pensada para personas de 6 carreras:</p>
        <ul className="list-disc pl-5">
          <li>Abogacía</li>
          <li>Contaduría, impuestos y finanzas</li>
          <li>Administración de empresas</li>
          <li>Comunicación</li>
          <li>Marketing digital y relaciones públicas</li>
          <li>Relaciones internacionales</li>
        </ul>
        <p>
          Si te formaste o trabajás en alguna de estas áreas, las evaluaciones y recomendaciones
          están adaptadas a tu perfil. Con el tiempo se irán sumando más carreras.
        </p>
      </div>
    ),
  },
  {
    q: "¿Cómo me anoto?",
    a: (
      <p>
        Entrás a la página{" "}
        <Link href="/acceso" className="text-link underline hover:text-fg">
          Pedir acceso
        </Link>{" "}
        (o escaneás el código QR que viste en la presentación), completás tu nombre, email, elegís
        tu carrera y nos contás cómo te enteraste. No necesitás poner tarjeta ni crear una
        contraseña en ese momento.
      </p>
    ),
  },
  {
    q: "¿Cuándo abre el acceso?",
    a: (
      <p>
        La beta cerrada abre el <strong>jueves 26 de noviembre</strong>. Antes de ese día te vamos a
        escribir por correo electrónico con tu invitación y el enlace para crear tu cuenta y empezar
        a usar la app.
      </p>
    ),
  },
  {
    q: "¿Cuánto cuesta?",
    a: (
      <p>
        Podés empezar con un plan gratis para probar la experiencia. También contamos con planes
        pagos para quienes quieren analizar más avisos por día y usar funciones avanzadas. Podés ver
        todas las opciones vigentes en la sección de{" "}
        <Link href="/precios" className="text-link underline hover:text-fg">
          Precios
        </Link>
        .
      </p>
    ),
  },
  {
    q: "¿Qué hace y qué NO hace la app?",
    a: (
      <div className="flex flex-col gap-2">
        <p>
          <strong>Lo que sí hace:</strong> lee las ofertas laborales, compara los requisitos con tu
          perfil, te explica los pros y contras de cada aviso y te orienta para adaptar tu
          currículum.
        </p>
        <p>
          <strong>Lo que NO hace:</strong> la app <em>no se postula por vos</em> (nunca envía
          postulaciones automáticas ni toca tus cuentas externas) y <em>no promete trabajo</em>. La
          decisión final de postularte y la entrevista siempre quedan en tus manos.
        </p>
      </div>
    ),
  },
  {
    q: "¿Qué pasa con mis datos y mi privacidad?",
    a: (
      <p>
        Tus datos son tuyos. Tu nombre, email, currículum y búsquedas se guardan de forma privada y
        segura. No vendemos tus datos a nadie ni los compartimos con empresas sin tu autorización.
        Podés consultar todos los detalles en nuestra{" "}
        <Link href="/legal/privacidad" className="text-link underline hover:text-fg">
          Política de privacidad
        </Link>
        .
      </p>
    ),
  },
  {
    q: "¿Cómo aviso si algo no funciona o tengo una consulta?",
    a: (
      <p>
        En todas las pantallas de la app vas a ver un botón flotante que dice{" "}
        <strong>«¿Algo no anduvo?»</strong>. Al tocarlo podés describir qué problema tuviste o qué
        no quedó claro. Leemos cada comentario para solucionarlo rápido durante la beta.
      </p>
    ),
  },
  {
    q: "¿Cómo me doy de baja si no quiero usar más la app?",
    a: (
      <p>
        Podés pedir la baja cuando quieras. Nos mandás un mensaje desde el correo con el que te
        anotaste solicitando el borrado de tu cuenta y eliminamos todos tus datos de nuestros
        registros, sin vueltas ni complicaciones.
      </p>
    ),
  },
  {
    q: "¿Necesito conocimientos técnicos o saber de programación?",
    a: (
      <p>
        No, para nada. La app fue diseñada especialmente para profesionales y estudiantes de
        ciencias sociales, económicas y jurídicas. Todo el lenguaje es claro, directo y sin jerga
        técnica.
      </p>
    ),
  },
];

export default function AyudaPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Preguntas frecuentes
        </h1>
        <p className="text-base text-fg-muted sm:text-lg">
          Respuestas simples sobre la beta cerrada, las carreras habilitadas y el funcionamiento de
          la app.
        </p>
      </header>

      <section className="flex flex-col gap-4" aria-label="Lista de preguntas frecuentes">
        {FAQS.map((faq, idx) => (
          <article
            key={idx}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5"
          >
            <h2 className="text-lg font-semibold text-fg">{faq.q}</h2>
            <div className="text-base leading-relaxed text-fg-muted">{faq.a}</div>
          </article>
        ))}
      </section>

      <section className="mt-4 flex flex-col items-center justify-between gap-4 rounded-card border border-line bg-surface-subtle p-6 text-center sm:flex-row sm:text-left">
        <div>
          <h2 className="text-lg font-semibold text-fg">¿Querés sumarte a la beta?</h2>
          <p className="text-sm text-fg-muted">
            Dejá tus datos en la lista de espera y te contactamos cuando abramos el acceso.
          </p>
        </div>
        <Link
          href="/acceso"
          className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-5 text-base font-medium text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Pedir acceso
        </Link>
      </section>
    </div>
  );
}
