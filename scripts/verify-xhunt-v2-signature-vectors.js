const crypto = require("crypto");

const APP_SIGNING_KEY = "xhunt-extension-v2-signing-key";

const cases = [
  {
    name: "Case 1: GET + query sorting",
    method: "GET",
    pathWithQuery: "/api/demo?a=1&b=1&b=2&x-language=en",
    timestamp: "1710000000000",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    fingerprint: "abcdef1234567890abcdef1234567890",
    twId: "1234567890",
    bodyText: "",
    expectedBodyHash:
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    expectedSignature:
      "51f54fa2a00761e84e24f11df07d972d6fc1982fd987d06930a0b80338ab38d95e75299cd865a3b94ee77ce4f63106979ea6ccd34a465855592df62afe761c04",
  },
  {
    name: "Case 2: POST + JSON body",
    method: "POST",
    pathWithQuery: "/api/xhunt/campaigns/register?campaign=alpha&x-language=zh",
    timestamp: "1710000001000",
    requestId: "550e8400-e29b-41d4-a716-446655440001",
    fingerprint: "11111111111111111111111111111111",
    twId: "9876543210",
    bodyText: '{"taskId":"task-1","score":10,"tags":["kol","vip"]}',
    expectedBodyHash:
      "8c96a0e0de7e65d4ee904673528df1e3d03f93ff5947d808d177f94e56d4a2d4d9d72b999e59762ba7ba33abee4ef1d59e7f9c1776cba6497cf303992b0d6a45",
    expectedSignature:
      "5b1351cea5578daf53f47ec710b4a1c08c43b536a6aabbe06f4236d095c6a36a8f7f0a082efb39f011e21f33ac055d9d2c7e4be4dce455758367a3eb6869238d",
  },
  {
    name: "Case 3: SSE GET",
    method: "GET",
    pathWithQuery: "/api/xhunt/sse/feeds?a=1&b=2&topic=kol&x-language=en",
    timestamp: "1710000002000",
    requestId: "550e8400-e29b-41d4-a716-446655440002",
    fingerprint: "22222222222222222222222222222222",
    twId: "1122334455",
    bodyText: "",
    expectedBodyHash:
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    expectedSignature:
      "33f7cd7b2fadd62d23961d52ead4924d0b1e90967d811c23f152a9d1d0002bc7d1988af1485dfe5938a836557dfe6e2e3274a956d58fffb1bc90e4d13bb71a84",
  },
];

function sha512Hex(input) {
  return crypto.createHash("sha512").update(input).digest("hex");
}

function hmacSha512Hex(key, input) {
  return crypto.createHmac("sha512", key).update(input).digest("hex");
}

let failed = 0;

for (const item of cases) {
  const bodyHash = sha512Hex(item.bodyText);
  const canonicalPayload = [
    item.method,
    item.pathWithQuery,
    item.timestamp,
    item.requestId,
    item.fingerprint,
    bodyHash,
    item.twId,
  ].join("\n");
  const signature = hmacSha512Hex(APP_SIGNING_KEY, canonicalPayload);

  const bodyHashOk = bodyHash === item.expectedBodyHash;
  const signatureOk = signature === item.expectedSignature;

  if (!bodyHashOk || !signatureOk) {
    failed += 1;
    console.error(`✗ ${item.name}`);
    console.error({ bodyHashOk, signatureOk, bodyHash, signature });
  } else {
    console.log(`✓ ${item.name}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log("All XHunt v2 signature vectors passed.");
}
