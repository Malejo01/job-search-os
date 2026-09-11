// packages/prompts: los prompts viven en *.md con frontmatter `version`. Este package solo los carga.
export {
  listPrompts,
  loadPrompt,
  parseFrontmatter,
  promptFileName,
  renderPrompt,
  templateVars,
  type Prompt,
  type PromptError,
  type PromptRef,
} from "./loader";
