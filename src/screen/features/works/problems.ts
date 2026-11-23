import type { DraftProblem } from "../../domain/works";
import type { MessageKey } from "./localeCatalog";

export const PROBLEM_KEY: Record<DraftProblem, MessageKey> = {
  title_required: "problem.title_required",
  title_long: "problem.title_long",
  block_text: "problem.block_text",
  slide_text: "problem.slide_text",
  column_name: "problem.column_name",
  sheet_shape: "problem.sheet_shape",
  content_large: "problem.content_large",
};
