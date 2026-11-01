import { pushAction, type FeedbackAction, type FeedbackContext } from "@job-search-os/pipeline";

let actionBuffer: FeedbackAction[] = [];

export function getActionBuffer(): readonly FeedbackAction[] {
  return actionBuffer;
}

export function recordAction(action: {
  type: "navigate" | "click";
  text: string;
  time?: string;
}): void {
  actionBuffer = pushAction(actionBuffer, action);
}

export function clearActionBuffer(): void {
  actionBuffer = [];
}

export function collectFeedbackContext(): FeedbackContext {
  if (typeof window === "undefined") {
    return { actions: [] };
  }
  const isDark = document.documentElement.classList.contains("dark");
  const theme = isDark ? "dark" : "light";
  const screen = `${window.innerWidth}x${window.innerHeight}`;
  const userAgent = navigator.userAgent;
  const pageTitle = document.title;
  // Solo el pathname sin query string
  const pathname = window.location.pathname;
  const appVersion =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_COMMIT ||
    process.env.NEXT_PUBLIC_APP_VERSION ||
    null;

  return {
    pathname,
    pageTitle,
    screen,
    userAgent,
    theme,
    appVersion,
    actions: [...actionBuffer],
  };
}
