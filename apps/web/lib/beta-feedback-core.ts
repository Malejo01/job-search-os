// La lógica pura vive en el pipeline (packages/pipeline/src/feedback/beta-feedback.ts)
export {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PATH_MAX,
  isFeedbackCategory,
  isOverDailyLimit,
  isValidFeedbackPath,
  normalizeFeedbackMessage,
  normalizeFeedbackPath,
  validateFeedback,
} from "@job-search-os/pipeline";
export type {
  FeedbackCategory,
  FeedbackField,
  FeedbackInput,
  FeedbackValidation,
} from "@job-search-os/pipeline";
