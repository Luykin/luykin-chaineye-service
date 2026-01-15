/**
 * 根据 ID、名称和类型构建 RootData 的可访问 URL。
 * 逻辑参考 src/xhunt/api/rootdata.js -> resolveLinkByIdName
 * @param {number|string} id 实体 ID
 * @param {string} name 实体名称
 * @param {1|2|3} type 实体类型 (1: Project, 2: Organization/VC, 3: Person)
 * @returns {{type: number, relativeLink: string, fullLink: string}}
 */
function buildRootdataUrl(id, name, type) {
  const idStr = String(id);
  const trimmedName = String(name || "").trim();

  // 1. 确定 URL 前缀
  let prefix;
  switch (type) {
    case 1: // Project
      prefix = "/Projects/detail";
      break;
    case 2: // Organization/VC
      prefix = "/Investors/detail";
      break;
    case 3: // Person
      prefix = "/member";
      break;
    default:
      // 默认按 Project 处理，保证回退
      prefix = "/Projects/detail";
      type = 1;
  }

  // 2. 对 ID 进行 Base64 编码，并对结果进行 URL 编码
  const encodedId = encodeURIComponent(
    Buffer.from(idStr, "utf-8").toString("base64")
  );

  // 3. 对名称进行 URL 编码
  const encodedName = encodeURIComponent(trimmedName);

  // 4. 组合 URL
  const relativeLink = `${prefix}/${encodedName}?k=${encodedId}`;
  const fullLink = `https://www.rootdata.com${relativeLink}`;

  return { type, relativeLink, fullLink };
}

module.exports = { buildRootdataUrl };
