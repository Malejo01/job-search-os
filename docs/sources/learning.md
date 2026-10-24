# Catálogo de aprendizaje: proveedores

Código: `packages/pipeline/src/learning/providers.ts` (`LEARNING_PROVIDERS`, `providerForUrl` y `checkModeForUrl`). Verificador de links: `packages/pipeline/src/learning/link-check.ts` y `packages/adapters/src/learning/check-links.ts`. Todavía no lo llama nadie.

**Se enlaza, no se copia.** De cada recurso guardamos título, proveedor, URL y horas, nunca contenido. Los términos de uso del sitio importan para una sola cosa: si permiten el chequeo automático del link, que es un `HEAD` a una URL que ya tenemos, sin recorrer el sitio.

**Estado: todo «a verificar».** Ningún proveedor tiene la fecha de lectura de términos (`termsReviewedAt`), así que el modo efectivo de todos es `manual`, aunque la columna «Chequeo propuesto» diga `auto`. Cuando Mauro lea los términos de uno, se anota la fecha en el código y en esta ficha, y recién ahí rige el modo propuesto. Un host que no está en la lista también es `manual`.

## Proveedores

| Proveedor | Hosts | Acceso | Idioma | Chequeo propuesto | Términos leídos |
|---|---|---|---|---|---|
| MDN Web Docs | developer.mozilla.org | gratis | es, en | auto | a verificar |
| React | react.dev | gratis | es, en | auto | a verificar |
| Next.js | nextjs.org | gratis | en | auto | a verificar |
| TypeScript | typescriptlang.org | gratis | es, en | auto | a verificar |
| Python | docs.python.org | gratis | es, en | auto | a verificar |
| PostgreSQL | postgresql.org | gratis | en | auto | a verificar |
| Docker | docs.docker.com | gratis | en | auto | a verificar |
| Kubernetes | kubernetes.io | gratis | es, en | auto | a verificar |
| Pro Git | git-scm.com | gratis | es, en | auto | a verificar |
| GitHub Docs | docs.github.com | gratis | es, en | auto | a verificar |
| OpenTelemetry | opentelemetry.io | gratis | en | auto | a verificar |
| freeCodeCamp | freecodecamp.org | gratis | es, en | auto | a verificar |
| Microsoft Learn | learn.microsoft.com | gratis (la certificación es paga) | es, en | auto | a verificar |
| AWS Skill Builder | skillbuilder.aws | gratis con cuenta | en | manual | a verificar |
| Google Skillshop | skillshop.withgoogle.com | gratis con cuenta | es, en | manual | a verificar |
| Google Cloud Skills Boost | cloudskillsboost.google | gratis con cuenta | es, en | manual | a verificar |
| HubSpot Academy | academy.hubspot.com | gratis con cuenta | es, en | manual | a verificar |
| Salesforce Trailhead | trailhead.salesforce.com | gratis con cuenta | es, en | manual | a verificar |
| Scrum Guides | scrumguides.org | gratis | es, en | manual | a verificar |
| Cisco Skills for All | skillsforall.com | gratis con cuenta | es, en | manual | a verificar |
| Kaggle Learn | kaggle.com | gratis con cuenta | en | manual | a verificar |
| The Odin Project | theodinproject.com | gratis | en | manual | a verificar |
| Coursera (audit) | coursera.org | se audita gratis, sin certificado | es, en | manual | a verificar |
| edX (audit) | edx.org | se audita gratis, sin certificado | es, en | manual | a verificar |
| YouTube (canales oficiales) | youtube.com, youtu.be | gratis | es, en | manual | a verificar |

**Fuera del catálogo (pagos):** DataCamp, Platzi y Udemy. Están en la lista para reconocerlos y no se chequean nunca. LinkedIn Learning tampoco entra, y no se lista ningún host de LinkedIn (ADR-004).

## A verificar (para Mauro)
- Los términos de cada proveedor: si permiten un `HEAD` automatizado a una URL guardada. Los que lo prohíban quedan `manual` para siempre.
- Los hosts de Meta Blueprint, Atlassian University, Figma Learn, Scrum.org, Linux Foundation y Google Actívate, que el diseño propone y acá no se listan porque no están confirmados.
- YouTube va solo como link, nunca embebido (cookies y privacidad).
- Coursera y edX: no todos los cursos permiten la auditoría gratuita. Se revisa curso por curso.
- El seed tiene 3 recursos de DataCamp marcados como gratis y aprobados. Corregirlo toca el seed y es carril rojo (E1d).
