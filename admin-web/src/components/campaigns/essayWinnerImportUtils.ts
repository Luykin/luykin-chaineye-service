export type EssayWinnerValue = {
  name: string;
  handler: string;
  avatar: string;
  reward: string;
  award: string;
  post: string;
  url: string;
};

export function normalizeHandle(value: string) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "");
}

export function normalizeUrl(value: string) {
  return String(value || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
}

export function appendEssayWinners(
  existingWinners: Array<Partial<EssayWinnerValue>>,
  importedWinners: EssayWinnerValue[],
) {
  const usedHandles = new Set(existingWinners.map((item) => normalizeHandle(item.handler || "").toLowerCase()).filter(Boolean));
  const usedUrls = new Set(existingWinners.map((item) => normalizeUrl(item.url || "")).filter(Boolean));
  let duplicateCount = 0;
  const appended = importedWinners.filter((winner) => {
    const handlerKey = normalizeHandle(winner.handler).toLowerCase();
    const urlKey = normalizeUrl(winner.url);
    const isDuplicate = urlKey ? usedUrls.has(urlKey) : !!handlerKey && usedHandles.has(handlerKey);
    if (isDuplicate) {
      duplicateCount += 1;
      return false;
    }
    if (handlerKey) usedHandles.add(handlerKey);
    if (urlKey) usedUrls.add(urlKey);
    return true;
  });
  const winners = [...existingWinners.map((item) => ({
    name: item.name || "",
    handler: item.handler || "",
    avatar: item.avatar || "",
    reward: item.reward || "",
    award: item.award || "",
    post: item.post || "",
    url: item.url || "",
  })), ...appended];

  return { winners, duplicateCount };
}
