function splitManualWinnerRewardLines(reward, unit) {
  const raw = String(reward ?? "").trim();
  if (!raw) return [];
  const cleanUnit = String(unit || "").trim();
  return raw
    .split(/\r?\n|\s*\+\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      if (index === 0 && cleanUnit && /^\d[\d,]*(\.\d+)?$/.test(line)) {
        return `${line} ${cleanUnit}`;
      }
      return line;
    });
}

function formatManualWinnerReward(reward, unit) {
  const lines = splitManualWinnerRewardLines(reward, unit);
  return lines.length ? lines.join(" + ") : null;
}

module.exports = {
  formatManualWinnerReward,
  splitManualWinnerRewardLines,
};
