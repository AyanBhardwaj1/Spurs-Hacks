import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { analysisProblems } from "./shape";
import type { MatchAnalysis } from "./types";

// The studio reads the pipeline's analysis from data/mnu-tot.json. It is read synchronously so a prerender
// bakes it into the page, and a dev server picks up a new run on the next request without a restart.

const PIPELINE_FILE = path.join(process.cwd(), "src/lib/studio/data/mnu-tot.json");

export function loadStudioAnalysis(): MatchAnalysis {
  if (!existsSync(PIPELINE_FILE)) {
    throw new Error(`${PIPELINE_FILE} is missing. Run the studio pipeline in scripts/studio to write it.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(PIPELINE_FILE, "utf8"));
  } catch (err) {
    throw new Error(`${PIPELINE_FILE} is not valid JSON: ${(err as Error).message}`);
  }
  return checkShape(parsed);
}

/** The analysis for one ScorePlay media ID, or undefined when that media has not been analysed. */
export function loadAnalysisFor(mediaId: number): MatchAnalysis | undefined {
  const analysis = loadStudioAnalysis();
  return analysis.source.id === mediaId ? analysis : undefined;
}

// Catches a file from an older or half-written pipeline run before the UI dereferences it.
function checkShape(value: unknown): MatchAnalysis {
  const problems = analysisProblems(value);
  if (problems.length > 0) {
    const shown = problems.slice(0, 12).join(", ");
    const more = problems.length > 12 ? ` and ${problems.length - 12} more` : "";
    throw new Error(`${PIPELINE_FILE} does not match MatchAnalysis in src/lib/studio/types.ts. Missing or wrong: ${shown}${more}`);
  }
  return value as MatchAnalysis;
}
