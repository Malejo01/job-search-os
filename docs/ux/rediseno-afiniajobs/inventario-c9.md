# Inventario C9: qué pantalla usa qué componente

Mapa de la tanda C9 (rediseño completo, 3/11) para no dejar ninguna pantalla con el diseño viejo. Se armó leyendo los `import` y los usos (`<Componente`) de `apps/web/app` y `apps/web/components` sobre `main` en `a394b9d` (C8 mergeado). La última columna dice qué ticket de C9 la cubre.

## Componentes compartidos

| Componente | Archivo | Quién lo usa | Ticket |
| --- | --- | --- | --- |
| Tokens, radios, tipografía | `app/globals.css`, `app/fonts.ts` | Toda la app | C9-2 |
| `Button`, `buttonClasses`, `textLinkClasses` | `components/ui/button.tsx` | Catálogos (`/ui`, `/settings/marca`) y, como clases, casi todas las pantallas | C9-3 |
| `Card`, `cardClasses` | `components/ui/card.tsx` | `/hoy`, catálogos y, como clases, listas | C9-3 |
| `Badge` | `components/ui/badge.tsx` | `/jobs` (job-list), `/jobs/pending-jd`, `/hoy` (new-job-row), `/demo/contaduria`, catálogos | C9-3 |
| `Field`, `inputClasses` | `components/ui/field.tsx` | Formularios (perfil, criterios, skills, cuenta, acceso) | C9-3 |
| `Alert` | `components/ui/alert.tsx` | `/jobs`, catálogos y avisos de formularios | C9-3 / C9-13 |
| `EmptyState` | `components/ui/empty-state.tsx` | `/jobs`, `/plan` | C9-3 / C9-13 |
| `Icon` | `components/ui/icons.tsx` | Chips, avisos, navegación | C9-3 |
| `ScoreBadge` (se reemplaza por el sello) | `components/ui/score-badge.tsx` | `/jobs/[id]`, `/hoy` (new-job-row), `onboarding/ofertas` (first-offers-list), `/demo/contaduria`, `/demo/[perfil]` (evaluation-card), catálogos. En `/jobs` (job-list) el puntaje está dibujado aparte | C9-5 |
| `OfferCard` | `components/offer-card.tsx` | Solo los catálogos: `/jobs` (job-list), `/hoy` y `onboarding/ofertas` arman su propia tarjeta | C9-8 |
| `RequisitosDelAviso` (+ `missingCta`) | `components/requisitos-del-aviso.tsx` | `/jobs/[id]`, `/encaje`, `/demo/[perfil]` | C9-9 |
| `HelpTip` («¿Qué es esto?», C8-6) | `components/help-tip.tsx` | `/jobs/[id]`, `/jobs/pending-jd`, `/cv`, `settings/target-roles-form` | C9-3 (estilo) |
| `StartHere` («Empezá acá», C8-5) | `app/(app)/hoy/start-here.tsx` + `lib/start-here.ts` | `/hoy` | C9-10 |
| `Logo` | `components/brand/logo.tsx` + `monogram.ts` | Headers (app, pública, legal, onboarding, EN), cuenta (login, registro, setup, olvidé, reset), `error.tsx`, `not-found.tsx`, `terminos-actualizados`, catálogos | C9-4 |
| `MainNav` | `app/(app)/main-nav.tsx` | Layout con sesión | C9-7 |
| `MobileTabbar` (R-3, `MOBILE_TABBAR_ENABLED`) | `app/(app)/mobile-tabbar.tsx` | Layout con sesión | C9-7 |
| `GuidedTour` | `components/guided-tour.tsx` | `/jobs`, onboarding (perfil, skills, ofertas) | C9-7 |
| `FeedbackButton`, `ActionTracker`, `AssistantButton`, `Avatar`, `PlanNotice` | `components/*`, `app/(app)/*` | Layout con sesión | C9-7 / C9-11 |
| `WaitlistForm`, `ShareButton` (C8-3) | `app/(public)/acceso/*` | `/acceso` | C9-16 |
| `GuardedForm`, `SubmitButton` | `app/components/*` | Formularios que no pierden lo escrito | C9-13 (F2) |
| Imagen OG | `lib/og-image.tsx` | `(public)/opengraph-image`, `twitter-image`, `(public-en)/opengraph-image-en` | C9-2 (fuentes) / C9-4 |
| Layout de emails | `packages/pipeline/src/email-layout.ts` | Alertas, bienvenida, recuperar contraseña, invitaciones | C9-4 / C9-16 |
| Íconos de la app | `app/icon.svg`, `app/apple-icon.png`, `public/icons/*`, `app/manifest.ts` | Navegador, iPhone, PWA | C9-4 |

### Animaciones que existen hoy (C9-14 las saca o las reemplaza)

`framer-motion` en `jobs/[id]/detail-motion.tsx`, `jobs/[id]/verdict-button.tsx`, `jobs/job-list.tsx`, `jobs/card-verdict.tsx`, `hoy/stagger-cards.tsx`, `market/bar-grow.tsx` y `assistant-panel.tsx`; `animate-pulse` en el puntaje pendiente de `ScoreBadge`.

## Pantallas con sesión — `app/(app)`

| Ruta | Archivo | Componentes | Ticket |
| --- | --- | --- | --- |
| (layout) | `layout.tsx` | `Logo`, `MainNav`, `MobileTabbar`, `Avatar`, `AssistantButton`, `PlanNotice`, `FeedbackButton`, `ActionTracker` | C9-7 |
| `/hoy` | `hoy/page.tsx` | `Card`, `ScoreBadge` (new-job-row), `Badge`, `StartHere`, `StaggerCards`, `MarkVisit` | C9-10 |
| `/jobs` | `jobs/page.tsx` | `JobList` (tarjeta propia + `CardVerdict`), `JobFilters`, `FirstSteps`, `RoleGaps`, `RoleNudge`, `EmailNudge`, `AutoRefresh`, `GuidedTour`, `EmptyState`, `Alert` | C9-5, C9-8, C9-9 (O3) |
| `/jobs/[id]` | `jobs/[id]/page.tsx` | `ScoreBadge`, `RequisitosDelAviso`, `HelpTip`, `DetailMotion`, `Verdict*`, `FitPointsPanel`, `ApplyButton`, `FormReview`, `ReviewNav`, `SourceAttribution`, `StatusCorrection`, `EvaluateNow`, `MergeButton`, `SkillLevelModal` | C9-9 |
| `/jobs/new` | `jobs/new/page.tsx` | `PasteForm`, `JobFields` | C9-11 |
| `/jobs/pending-jd` | `jobs/pending-jd/page.tsx` | `Badge`, `HelpTip`, `CharCounter`, `CopyButton` | C9-11 |
| `/applications` | `applications/page.tsx` | `ui`, acciones de seguimiento | C9-8, C9-11 |
| `/cv`, `/cv/armar` | `cv/page.tsx`, `cv/armar/page.tsx` | `CvPreview` (hoja blanca a propósito), `PrintButton`, `HelpTip`, `Chat` | C9-11 |
| `/encaje` | `encaje/page.tsx` | `RequisitosDelAviso`, `RoleTabs` | C9-11 |
| `/market` | `market/page.tsx` | `CareerMarket`, `CareerPicker`, `DataStateNotice`, `RoleMarket`, `RoleTabs`, `SkillCandidates`, `SkillRows`, `BarGrow` | C9-11 |
| `/inbox`, `/inbox/[id]` | `inbox/*` | `BulkBar`, `DeleteDomainButton`, `EmailActions`, `LeakActions`, `UndoNotice`; el email va en `iframe` con `sandbox` vacío | C9-11 |
| `/plan` | `plan/page.tsx` | `EmptyState`, `DataStateNotice`, `SiAprendes` | C9-11 |
| `/settings` | `settings/page.tsx` | `ThemeSelect`, `TargetRolesForm`, `InboundAddress`, `DeleteAccountForm` | C9-11 |
| `/settings/perfil` | `settings/perfil/page.tsx` | `ProfileFormWithProposal` | C9-11 |
| `/settings/criteria` | `settings/criteria/page.tsx` | `AssistantProposalLoader`, `SaveButton` | C9-11 |
| `/settings/skills` | `settings/skills/page.tsx` | `SkillsForm`, `SkillSearch` | C9-11 |
| `/settings/senders` | `settings/senders/page.tsx` | — | C9-11 |
| `/settings/historial` | `settings/historial/page.tsx` | — | C9-11 |
| `/settings/asistente` | `settings/asistente/page.tsx` | `Assistant` (onboarding) | C9-11 |
| Admin: `/settings/invitations`, `/metricas`, `/feedback`, `/planes`, `/salud`, `/textos`, `/marca` | `settings/*` | Primitivas; `/settings/marca` tiene el catálogo de marca (R-1 de C7) | C9-11 (solo primitivas), C9-3 (catálogo nuevo en `/settings/marca/componentes`) |
| `/ui` (catálogo viejo de N3-3) | `ui/page.tsx` | `Logo`, `OfferCard`, todas las primitivas | C9-3 |

## Onboarding — `app/onboarding`

| Ruta | Componentes | Ticket |
| --- | --- | --- |
| (layout) | `Logo` | C9-7 |
| `/onboarding` | `GuidedTour`, `OnboardingForm`, `Steps`, `DeleteAccountForm`, `CountrySearch` | C9-11 |
| `/onboarding/skills` | `GuidedTour`, `SkillsForm`, `Steps` | C9-11 |
| `/onboarding/ofertas` | `GuidedTour`, `Steps`, `FirstOffersList` (`ScoreBadge`) | C9-5, C9-11 |
| `/onboarding/asistente` | `Assistant`, `PrivacyDialog`, `CopyButton` | C9-11 |

## Cuenta — `app/(auth)`

`/login`, `/register`, `/forgot-password`, `/reset-password`, `/setup`: `Logo` y formularios con las primitivas. Ticket C9-16 (comparten lo público) y C9-11.

## Públicas — `app/(public)`, `app/(public-en)`, `app/legal`

| Ruta | Componentes | Ticket |
| --- | --- | --- |
| (layout) | `Logo` | C9-16 |
| `/` (portada) | `PoolNumbers` | C9-16 |
| `/acceso` | `WaitlistForm`, `ShareButton` (C8-3) | C9-16 |
| `/precios`, `/ayuda` | — | C9-16 (textos de `/ayuda` en C9-15) |
| `/demo`, `/demo/[perfil]`, `/demo/contaduria` | `EvaluationCard` (`ScoreBadge`, `RequisitosDelAviso`), `Tour`, `Feedback`, `DemoPaste` | C9-5, C9-16 |
| `/mercado`, `/mercado/[carrera]` | `CareerChips`, `PoolNumbers` | C9-16 |
| `/ofertas`, `/ofertas/[carrera]` | `CareerChips`, `OffersList`, `ModalityFilter` (lista propia, sin puntaje) | C9-16 |
| `/como-esta-hecho`, `/en/how-its-built` | `FlowDiagram`, `PoolNumbers` | C9-16 |
| `/legal/terminos`, `/legal/privacidad` | `Logo` en el layout. **Solo estilo, nunca texto** | C9-16 |
| `/terminos-actualizados` | `Logo`, `Form`, `DeleteAccountForm` | C9-16 |
| `(public)/not-found.tsx` | — | C9-13 |
| Imágenes OG | `lib/og-image.tsx` | C9-4 |

## Errores

`app/not-found.tsx` (`Logo`, primitivas), `app/error.tsx` (`Logo`, primitivas), `app/global-error.tsx` (HTML propio, sin la app) y `(public)/not-found.tsx`. Ticket C9-13 (F1).

## Variables de C8 que siguen apagadas

`START_HERE_ENABLED`, `HELP_TIPS_ENABLED`, `FEEDBACK_TRIAGE_ENABLED`, `ACCESO_FUNNEL_ENABLED`: el rediseño las viste igual (los e2e las prenden en `playwright.config.ts`). `MOBILE_TABBAR_ENABLED` se invierte en C9-7: las pestañas quedan prendidas por defecto.
