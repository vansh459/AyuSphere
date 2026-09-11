/**
 * Recruitment analytics (workflow.md §10, feature plan "Recruitment
 * Analytics" / "Recruitment Delay Prediction"). Rule-based decision support —
 * labeled as such, never a clinical conclusion.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type RecruitmentInput = {
  enrolled: number;
  target: number;
  activatedAt: Date;
  /** planned recruitment window end; null = open-ended */
  windowEnd?: Date | null;
};

export type RiskBand = "on_track" | "at_risk" | "behind";

export type RecruitmentAnalysis = {
  /** participants per week since activation */
  velocity: number;
  /** fraction of target reached, 0…1 */
  progress: number;
  /** weeks to reach target at current velocity; null when velocity is 0 */
  projectedWeeksToTarget: number | null;
  band: RiskBand;
  explanation: string;
};

export function analyzeRecruitment(
  input: RecruitmentInput,
  now = new Date(),
): RecruitmentAnalysis {
  const weeksElapsed = Math.max(
    (now.getTime() - input.activatedAt.getTime()) / WEEK_MS,
    1 / 7, // avoid divide-by-near-zero on day one
  );
  const velocity = input.enrolled / weeksElapsed;
  const progress = input.target > 0 ? Math.min(input.enrolled / input.target, 1) : 0;
  const remaining = Math.max(input.target - input.enrolled, 0);
  const projectedWeeksToTarget =
    remaining === 0 ? 0 : velocity > 0 ? remaining / velocity : null;

  let band: RiskBand;
  let explanation: string;

  if (progress >= 1) {
    band = "on_track";
    explanation = "Target reached.";
  } else if (input.windowEnd) {
    const weeksLeft = (input.windowEnd.getTime() - now.getTime()) / WEEK_MS;
    if (projectedWeeksToTarget === null || weeksLeft <= 0) {
      band = "behind";
      explanation =
        weeksLeft <= 0
          ? "Recruitment window has closed below target."
          : "No enrolments yet — target unreachable at current pace.";
    } else if (projectedWeeksToTarget <= weeksLeft) {
      band = "on_track";
      explanation = `Projected to reach target in ${projectedWeeksToTarget.toFixed(1)} weeks, within the ${weeksLeft.toFixed(1)}-week window.`;
    } else if (projectedWeeksToTarget <= weeksLeft * 1.5) {
      band = "at_risk";
      explanation = `Projected ${projectedWeeksToTarget.toFixed(1)} weeks vs ${weeksLeft.toFixed(1)} remaining — modest shortfall.`;
    } else {
      band = "behind";
      explanation = `Projected ${projectedWeeksToTarget.toFixed(1)} weeks vs ${weeksLeft.toFixed(1)} remaining — significant shortfall.`;
    }
  } else {
    // no window: judge by pace vs a linear ideal is impossible, use progress heuristic
    if (velocity === 0 && input.enrolled === 0) {
      band = "behind";
      explanation = "No enrolments since activation.";
    } else if (progress >= 0.5) {
      band = "on_track";
      explanation = "Past the halfway mark.";
    } else if (progress >= 0.2) {
      band = "at_risk";
      explanation = "Under half of target with no defined window.";
    } else {
      band = "behind";
      explanation = "Enrolment far below target.";
    }
  }

  return { velocity, progress, projectedWeeksToTarget, band, explanation };
}
