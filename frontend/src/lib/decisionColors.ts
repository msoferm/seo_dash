/** One distinct color per accepted structure decision (cycled), so decisions are told apart. */
export const DECISION_COLORS = [
  { bg: "#eef2ff", border: "#6366f1", text: "#3730a3" }, // indigo
  { bg: "#f0fdfa", border: "#14b8a6", text: "#115e59" }, // teal
  { bg: "#fff7ed", border: "#f97316", text: "#9a3412" }, // orange
  { bg: "#fdf2f8", border: "#ec4899", text: "#9d174d" }, // pink
  { bg: "#f7fee7", border: "#84cc16", text: "#3f6212" }, // lime
  { bg: "#ecfeff", border: "#06b6d4", text: "#155e75" }, // cyan
  { bg: "#fdf4ff", border: "#d946ef", text: "#86198f" }, // fuchsia
  { bg: "#fff1f2", border: "#f43f5e", text: "#9f1239" }, // rose
];
export const decisionColor = (i: number) => DECISION_COLORS[((i % DECISION_COLORS.length) + DECISION_COLORS.length) % DECISION_COLORS.length];
/** Highlight for the recommendation currently being reviewed (before it is accepted). */
export const SELECTED_COLOR = { bg: "#fffbeb", border: "#f59e0b", text: "#92400e" };

export const REC_TYPE_LABEL: Record<string, string> = {
  same_intent: "אותה כוונת משתמש",
  cannibalization: "קניבליזציה",
  relocate: "מילים מדורגות שמתאימות יותר לעמוד אחר",
  unassigned: "שיוך מילים לעמוד",
  new_page: "דורש עמוד חדש",
  site_strategy: "אסטרטגיה ומבנה היררכי של האתר",
};
