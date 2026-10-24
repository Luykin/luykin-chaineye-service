const USDC_SCALE = 1_000_000n;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_DISTRIBUTION_RECIPIENTS = 500;

function toUsdcMicros(value, { allowZero = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) throw new Error("INVALID_USDC_AMOUNT");
  const [whole, fraction = ""] = raw.split(".");
  const micros = BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, "0"));
  if (micros < 0n || (!allowZero && micros === 0n)) throw new Error("INVALID_USDC_AMOUNT");
  return micros;
}

function formatUsdcMicros(micros) {
  const value = BigInt(micros);
  const whole = value / USDC_SCALE;
  const fraction = String(value % USDC_SCALE).padStart(6, "0");
  return `${whole}.${fraction}`;
}

function allocateUsdcMicros(totalMicros, entries) {
  const total = BigInt(totalMicros);
  const normalized = entries.map((entry, index) => ({
    ...entry,
    index,
    weight: BigInt(entry.weight),
  }));
  const totalWeight = normalized.reduce((sum, entry) => sum + (entry.weight > 0n ? entry.weight : 0n), 0n);
  if (total < 0n || totalWeight <= 0n || !normalized.length) throw new Error("INVALID_ALLOCATION_INPUT");

  let allocated = 0n;
  const result = normalized.map((entry) => {
    const numerator = total * (entry.weight > 0n ? entry.weight : 0n);
    const amount = numerator / totalWeight;
    allocated += amount;
    return { ...entry, amount, remainder: numerator % totalWeight };
  });
  let remainderUnits = total - allocated;
  const remainderOrder = [...result].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.index - b.index;
  });
  for (let i = 0; remainderUnits > 0n; i += 1, remainderUnits -= 1n) {
    remainderOrder[i % remainderOrder.length].amount += 1n;
  }
  return result.sort((a, b) => a.index - b.index);
}

function aggregateDistributionRecipients(items, { feeAddress, feeMicros = 0n } = {}) {
  const grouped = new Map();
  const add = (address, amount) => {
    const normalized = String(address || "").trim();
    if (!EVM_ADDRESS_PATTERN.test(normalized) || normalized.toLowerCase() === ZERO_ADDRESS) {
      throw new Error("INVALID_RECIPIENT_ADDRESS");
    }
    const micros = BigInt(amount);
    if (micros <= 0n) return;
    const key = normalized.toLowerCase();
    const previous = grouped.get(key);
    grouped.set(key, {
      address: previous?.address || normalized,
      amountMicros: (previous?.amountMicros || 0n) + micros,
    });
  };
  items.forEach((item) => add(item.address, item.amountMicros));
  if (BigInt(feeMicros) > 0n) add(feeAddress, feeMicros);
  return Array.from(grouped.values())
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))
    .map((item) => ({ address: item.address, amount: formatUsdcMicros(item.amountMicros) }));
}

module.exports = {
  USDC_SCALE,
  EVM_ADDRESS_PATTERN,
  MAX_DISTRIBUTION_RECIPIENTS,
  ZERO_ADDRESS,
  toUsdcMicros,
  formatUsdcMicros,
  allocateUsdcMicros,
  aggregateDistributionRecipients,
};
