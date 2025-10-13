export const HEATMAP_COLORS = [
  '#e0e7ef', // 0% (lightest)
  '#b2d6f6', // 1-24%
  '#7fc6ee', // 25-49%
  '#4fa3e3', // 50-74%
  '#2286c3', // 75-99%
  '#1b5e20', // 100%+ (darkest)
];

export function getHeatmapColor(percent: number) {
  if (percent >= 100) return HEATMAP_COLORS[5];
  if (percent >= 75) return HEATMAP_COLORS[4];
  if (percent >= 50) return HEATMAP_COLORS[3];
  if (percent >= 25) return HEATMAP_COLORS[2];
  if (percent > 0) return HEATMAP_COLORS[1];
  return HEATMAP_COLORS[0];
}
