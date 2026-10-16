const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;

const COLORS = {
  bg: '#f3f6fb',
  paper: '#fbfdff',
  grid: '#dce7f3',
  panel: '#ffffff',
  border: '#1f2a3d',
  borderSoft: '#9fb5ce',
  blue: '#b9ddff',
  blue2: '#7fbcf5',
  blueDark: '#2f7fca',
  lane: '#edf5ff',
  laneAlt: '#f8fbff',
  text: '#1e293b',
  muted: '#64748b',
  dashed: '#2f3a4d',
  arrow: '#172033',
  frame: '#ffffff',
  frameTitle: '#ddecff',
  success: '#dbf8e9',
  warn: '#fff4c7',
  danger: '#ffe2e2',
  violet: '#ede9fe',
  shadow: 'rgba(30, 41, 59, 0.16)',
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text, maxChars = 26) {
  const raw = String(text);
  if (raw.length <= maxChars) return [raw];
  const parts = [];
  let current = '';
  for (const ch of raw) {
    const isAscii = ch.charCodeAt(0) < 128;
    const len = current.length + (isAscii ? 0.65 : 1);
    if (len >= maxChars) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.slice(0, 3);
}

function textBlock(x, y, text, opts = {}) {
  const { size = 15, weight = 500, fill = COLORS.text, anchor = 'middle', maxChars = 28, lineHeight = 20 } = opts;
  const lines = wrapText(text, maxChars);
  const dy0 = lines.length === 1 ? 0 : -(lines.length - 1) * lineHeight / 2;
  return lines.map((line, i) => `<text x="${x}" y="${y + dy0 + i * lineHeight}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`).join('\n');
}

function rect(x, y, w, h, opts = {}) {
  const { fill = COLORS.blue, stroke = COLORS.border, sw = 2.2, rx = 10, dash = '', opacity = 1, filter = '' } = opts;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''} ${filter ? `filter="${filter}"` : ''}/>`;
}

function estimateLabelWidth(label, min = 190, max = 430) {
  const clean = String(label).replace(/^\d+[A-Z]?\.\s*/, '');
  let units = 0;
  for (const ch of clean) units += ch.charCodeAt(0) < 128 ? 7.5 : 15;
  return Math.max(min, Math.min(max, units + 58));
}

function splitStepLabel(label) {
  const m = String(label).match(/^(\d+[A-Z]?)\.\s*(.*)$/);
  return m ? { num: m[1], text: m[2] } : { num: '', text: label };
}

function arrow(x1, y1, x2, y2, label, opts = {}) {
  const { dashed = false, color = COLORS.arrow, labelY = -18, labelX = 0, size = 15 } = opts;
  const dash = dashed ? 'stroke-dasharray="9 8"' : '';
  const midX = (x1 + x2) / 2 + labelX;
  const dir = x2 >= x1 ? 1 : -1;
  const { num, text } = splitStepLabel(label);
  const pillW = estimateLabelWidth(label, 170, Math.abs(x2 - x1) + 140);
  const pillH = 34;
  const pillX = midX - pillW / 2;
  const pillY = y1 + labelY - pillH / 2;
  const fill = dashed ? '#ffffff' : '#f8fbff';
  const badgeFill = dashed ? COLORS.borderSoft : COLORS.blueDark;
  return `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.6" stroke-linecap="round" ${dash} marker-end="url(#arrow-${dir > 0 ? 'right' : 'left'})"/>
    <g filter="url(#softShadow)">
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="17" fill="${fill}" stroke="${COLORS.borderSoft}" stroke-width="1.2"/>
      ${num ? `<circle cx="${pillX + 20}" cy="${pillY + pillH / 2}" r="12" fill="${badgeFill}"/><text x="${pillX + 20}" y="${pillY + pillH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="800" fill="#fff">${esc(num)}</text>` : ''}
      ${textBlock(pillX + (num ? 40 : 16), pillY + pillH / 2 + 1, text, { size, anchor: 'start', maxChars: 34, fill: COLORS.text, weight: 650 })}
    </g>
  `;
}

function selfCall(x, y, label, opts = {}) {
  const { w = 82, h = 46, size = 14 } = opts;
  const { num, text } = splitStepLabel(label);
  return `
    <path d="M ${x} ${y} C ${x + 45} ${y}, ${x + w} ${y + 4}, ${x + w} ${y + h / 2} C ${x + w} ${y + h - 4}, ${x + 45} ${y + h}, ${x + 8} ${y + h}" fill="none" stroke="${COLORS.arrow}" stroke-width="2.4" marker-end="url(#arrow-left)"/>
    <g filter="url(#softShadow)">
      <rect x="${x + w + 8}" y="${y + 5}" width="${estimateLabelWidth(label, 176, 285)}" height="${h - 2}" rx="14" fill="#ffffff" stroke="${COLORS.borderSoft}" stroke-width="1.1"/>
      ${num ? `<circle cx="${x + w + 28}" cy="${y + h / 2 + 4}" r="11" fill="${COLORS.violet === undefined ? COLORS.blueDark : '#7c3aed'}"/><text x="${x + w + 28}" y="${y + h / 2 + 5}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="800" fill="#fff">${esc(num)}</text>` : ''}
      ${textBlock(x + w + (num ? 46 : 22), y + h / 2 + 5, text, { size, anchor: 'start', maxChars: 22, weight: 650 })}
    </g>
  `;
}

function frame(x, y, w, h, title, kind = 'loop') {
  const tagW = Math.min(440, title.length * 15 + kind.length * 10 + 70);
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#ffffff" fill-opacity="0.36" stroke="${COLORS.border}" stroke-width="2.1"/>
    <path d="M ${x + 1} ${y + 1} H ${x + tagW} Q ${x + tagW + 20} ${y + 1} ${x + tagW + 28} ${y + 21} L ${x + tagW + 38} ${y + 45} H ${x + 1} Z" fill="${COLORS.frameTitle}" stroke="${COLORS.border}" stroke-width="2"/>
    <text x="${x + 18}" y="${y + 28}" font-size="16" font-weight="850" fill="${COLORS.text}" letter-spacing="0.2">${esc(kind)} · ${esc(title)}</text>
  `;
}

function divider(y, label, x = 90, w = 1120) {
  const tagW = Math.min(560, label.length * 15 + 54);
  return `
    <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y}" stroke="${COLORS.borderSoft}" stroke-width="2" stroke-dasharray="11 10"/>
    <g filter="url(#softShadow)">
      <rect x="${x + 12}" y="${y - 19}" width="${tagW}" height="38" rx="19" fill="${COLORS.warn}" stroke="${COLORS.borderSoft}" stroke-width="1.2"/>
      <text x="${x + 32}" y="${y + 1}" font-size="15" font-weight="850" fill="${COLORS.text}" dominant-baseline="middle">${esc(label)}</text>
    </g>
  `;
}

function renderDiagram({ file, title, subtitle, actors, steps, width = 1400, height = 980, note }) {
  const yShift = 180;
  const outputHeight = height + yShift;
  const actorTop = 172;
  const lineTop = 268;
  const lineBottom = outputHeight - 96;
  const laneW = (width - 176) / (actors.length - 1);
  const xs = actors.map((_, i) => 88 + i * laneW);
  const actorWidth = Math.min(210, laneW - 38);
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${outputHeight}" viewBox="0 0 ${width} ${outputHeight}">
  <defs>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="${COLORS.grid}" stroke-width="0.8" opacity="0.45"/></pattern>
    <linearGradient id="headerGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#eaf4ff"/><stop offset="1" stop-color="#9bd0ff"/></linearGradient>
    <linearGradient id="activeGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#93caff"/><stop offset="1" stop-color="#d8ecff"/></linearGradient>
    <marker id="arrow-right" markerWidth="13" markerHeight="13" refX="10.5" refY="6.5" orient="auto" markerUnits="strokeWidth"><path d="M2,2 L11,6.5 L2,11 Z" fill="${COLORS.arrow}"/></marker>
    <marker id="arrow-left" markerWidth="13" markerHeight="13" refX="2.5" refY="6.5" orient="auto" markerUnits="strokeWidth"><path d="M11,2 L2,6.5 L11,11 Z" fill="${COLORS.arrow}"/></marker>
    <filter id="softShadow" x="-15%" y="-30%" width="130%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#1e293b" flood-opacity="0.13"/></filter>
    <filter id="cardShadow" x="-15%" y="-20%" width="130%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#1e293b" flood-opacity="0.14"/></filter>
  </defs>
  <rect width="${width}" height="${outputHeight}" fill="${COLORS.bg}"/>
  <rect x="24" y="22" width="${width - 48}" height="${outputHeight - 44}" rx="28" fill="${COLORS.paper}" stroke="#d9e4f2" stroke-width="1.2" filter="url(#cardShadow)"/>
  <rect x="24" y="22" width="${width - 48}" height="${outputHeight - 44}" rx="28" fill="url(#grid)"/>
  <rect x="40" y="38" width="${width - 80}" height="78" rx="22" fill="#ffffff" fill-opacity="0.78" stroke="#dbe7f5" stroke-width="1"/>
  <text x="62" y="68" font-size="25" font-weight="900" fill="${COLORS.text}" letter-spacing="0.2">${esc(title)}</text>
  ${subtitle ? `<text x="62" y="98" font-size="15" fill="${COLORS.muted}">${esc(subtitle)}</text>` : ''}
`;

  actors.forEach((a, i) => {
    const x = xs[i];
    const laneFill = i % 2 === 0 ? COLORS.laneAlt : COLORS.lane;
    svg += `<rect x="${x - laneW / 2 + 8}" y="128" width="${laneW - 16}" height="${lineBottom - 118}" rx="22" fill="${laneFill}" opacity="0.58" stroke="#dfeaf6" stroke-width="0.8"/>`;
    if (a.type === 'actor') {
      svg += `
        <g filter="url(#softShadow)">
          <circle cx="${x}" cy="${actorTop - 22}" r="16" fill="url(#headerGrad)" stroke="${COLORS.border}" stroke-width="2.8"/>
          <line x1="${x}" y1="${actorTop - 6}" x2="${x}" y2="${actorTop + 38}" stroke="${COLORS.border}" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="${x - 34}" y1="${actorTop + 10}" x2="${x + 34}" y2="${actorTop + 10}" stroke="${COLORS.border}" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="${x}" y1="${actorTop + 38}" x2="${x - 25}" y2="${actorTop + 74}" stroke="${COLORS.border}" stroke-width="3.2" stroke-linecap="round"/>
          <line x1="${x}" y1="${actorTop + 38}" x2="${x + 25}" y2="${actorTop + 74}" stroke="${COLORS.border}" stroke-width="3.2" stroke-linecap="round"/>
        </g>
        <rect x="${x - 54}" y="${actorTop + 88}" width="108" height="34" rx="17" fill="#ffffff" stroke="${COLORS.borderSoft}" stroke-width="1.1"/>
        ${textBlock(x, actorTop + 106, a.label, { size: 15, weight: 800, maxChars: 12 })}
      `;
    } else {
      svg += `
        <g filter="url(#softShadow)">${rect(x - actorWidth/2, actorTop - 30, actorWidth, 58, { fill: 'url(#headerGrad)', rx: 10, sw: 2.5 })}</g>
        ${textBlock(x, actorTop, a.label, { size: 17, weight: 850, maxChars: 16 })}
      `;
    }
    svg += `<line x1="${x}" y1="${lineTop}" x2="${x}" y2="${lineBottom}" stroke="${COLORS.dashed}" stroke-width="2.1" stroke-dasharray="4 10" opacity="0.75"/>`;
    svg += rect(x - 11, lineTop + 28, 22, Math.max(92, lineBottom - lineTop - 88), { fill: 'url(#activeGrad)', stroke: COLORS.border, sw: 2.1, rx: 8 });
  });

  for (const st of steps) {
    const y = typeof st.y === 'number' ? st.y + yShift : st.y;
    if (st.type === 'arrow') {
      svg += arrow(xs[st.from], y, xs[st.to], y, st.label, st);
    } else if (st.type === 'self') {
      svg += selfCall(xs[st.at] + 13, y, st.label, st);
    } else if (st.type === 'frame') {
      svg += frame(st.x ?? 52, y, st.w ?? width - 104, st.h, st.title, st.kind ?? 'Loop');
    } else if (st.type === 'divider') {
      svg += divider(y, st.label, st.x ?? 72, st.w ?? width - 144);
    } else if (st.type === 'note') {
      svg += rect(st.x, y, st.w, st.h, { fill: st.fill || COLORS.warn, stroke: COLORS.borderSoft, sw: 1.3, rx: 12, filter: 'url(#softShadow)' });
      svg += textBlock(st.x + 16, y + st.h/2, st.label, { size: st.size || 15, weight: 700, anchor: 'start', maxChars: st.maxChars || 42 });
    }
  }

  if (note) {
    svg += rect(46, outputHeight - 70, width - 92, 42, { fill: '#eff7ff', stroke: '#bad5ef', sw: 1.1, rx: 16 });
    svg += `<text x="66" y="${outputHeight - 47}" font-size="14" font-weight="650" fill="${COLORS.muted}">${esc(note)}</text>`;
  }

  svg += '</svg>\n';
  fs.writeFileSync(path.join(OUT_DIR, file), svg);
}


renderDiagram({
  file: '01-admin-create-monitored-account.svg',
  title: '01 运营新增被监控账号时序图',
  subtitle: '从 admin-web 输入 X handle，到创建看板、初始化 7D 任务、进入监控状态',
  width: 1480,
  height: 1060,
  actors: [
    { label: '运营人员', type: 'actor' },
    { label: 'admin-web', type: 'box' },
    { label: 'Admin API', type: 'box' },
    { label: 'meta只读库', type: 'box' },
    { label: '主业务库', type: 'box' },
    { label: 'Jobs进程', type: 'box' },
    { label: 'Redis', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 188, label: '1. 输入官方 handle，点击识别' },
    { type: 'arrow', from: 1, to: 2, y: 228, label: '2. POST /monitored-accounts/resolve' },
    { type: 'self', at: 2, y: 250, label: '规范化 handle / 校验格式' },
    { type: 'arrow', from: 2, to: 3, y: 322, label: '3. 查 dev.twitter_user.username' },
    { type: 'arrow', from: 3, to: 2, y: 368, label: '4. 返回 id/profile/feature/kol', dashed: true },
    { type: 'self', at: 2, y: 392, label: '提取头像、粉丝、kolCnRank' },
    { type: 'arrow', from: 2, to: 1, y: 464, label: '5. 返回待确认账号资料', dashed: true },
    { type: 'arrow', from: 1, to: 0, y: 504, label: '6. 展示账号快照', dashed: true },
    { type: 'divider', y: 548, label: '运营确认创建' },
    { type: 'arrow', from: 0, to: 1, y: 604, label: '7. 填项目名/关键词并提交' },
    { type: 'arrow', from: 1, to: 2, y: 644, label: '8. POST /monitored-accounts' },
    { type: 'arrow', from: 2, to: 4, y: 684, label: '9. 查 EchohuntSocialListeningBoards' },
    { type: 'frame', y: 716, h: 196, title: '不存在 active board 时创建', kind: 'Alt' },
    { type: 'arrow', from: 2, to: 4, y: 764, label: '10. INSERT Boards(status=initializing)' },
    { type: 'arrow', from: 2, to: 4, y: 804, label: '11. INSERT AccessAuditLogs(board_create)' },
    { type: 'arrow', from: 2, to: 4, y: 844, label: '12. 创建初始化最近7天任务' },
    { type: 'arrow', from: 2, to: 6, y: 884, label: '13. 可选写任务通知/短缓存' },
    { type: 'arrow', from: 2, to: 1, y: 944, label: '14. 返回 board + 初始化任务', dashed: true },
    { type: 'arrow', from: 5, to: 4, y: 984, label: '15. 领取待执行初始化任务' },
  ],
  note: '核心写表：EchohuntSocialListeningBoards / Jobs / AccessAuditLogs；核心读表：dev.twitter_user / dev.cache',
});

renderDiagram({
  file: '02-backend-job-computation.svg',
  title: '02 后台任务调度总览时序图',
  subtitle: '不是每 30 分钟执行一次：建议 15 分钟调度一次；任务内部按 30min/1h 时间片分片扫描',
  width: 1480,
  height: 980,
  actors: [
    { label: 'Jobs进程', type: 'box' },
    { label: 'Redis锁', type: 'box' },
    { label: '主业务库', type: 'box' },
    { label: 'meta.dev数据表', type: 'box' },
    { label: 'AI服务', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 2, y: 172, label: '1. 每 15分钟检查要处理的看板和任务' },
    { type: 'arrow', from: 0, to: 1, y: 242, label: '2. 锁住这个看板，避免重复跑' },
    { type: 'frame', y: 300, h: 350, title: '单个 board 的后台处理', kind: 'Loop' },
    { type: 'arrow', from: 0, to: 2, y: 362, label: '3. 标记任务开始处理' },
    { type: 'arrow', from: 0, to: 3, y: 432, label: '4. 按时间片读取帖子/用户/关注数据' },
    { type: 'arrow', from: 3, to: 0, y: 502, label: '5. 返回新增帖子和作者资料', dashed: true },
    { type: 'arrow', from: 0, to: 2, y: 572, label: '6. 筛出相关帖子并去重保存' },
    { type: 'arrow', from: 0, to: 4, y: 702, label: '7. 把未分析的帖子送给 AI' },
    { type: 'arrow', from: 4, to: 0, y: 772, label: '8. 返回情绪、主题、关键词', dashed: true },
    { type: 'arrow', from: 0, to: 2, y: 842, label: '9. 保存帖子分析、图表、账号动态、预警' },
    { type: 'arrow', from: 0, to: 1, y: 912, label: '10. 处理完释放锁，等待下一轮', dashed: true },
  ],
  note: '这里是总览图；AI 输入输出和字段落表请看 02A/02B 两张细图。',
});

renderDiagram({
  file: '02a-post-recall-and-upsert.svg',
  title: '02A 推文召回、作者快照、去重落表时序图',
  subtitle: '先把命中的候选推文整理成帖子结果表，再送 AI 分析',
  width: 1500,
  height: 1120,
  actors: [
    { label: 'Jobs进程', type: 'box' },
    { label: '监控看板表', type: 'box' },
    { label: 'dev.tweet', type: 'box' },
    { label: 'dev.twitter_user', type: 'box' },
    { label: '帖子结果表', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 172, label: '1. 读取被监控账号配置' },
    { type: 'arrow', from: 1, to: 0, y: 242, label: '2. 官方账号ID、handle、关键词', dashed: true },
    { type: 'frame', y: 292, h: 418, title: '把时间范围拆小段处理', kind: 'Loop' },
    { type: 'arrow', from: 0, to: 2, y: 360, label: '3. 查询这段时间的新帖子' },
    { type: 'arrow', from: 2, to: 0, y: 430, label: '4. 帖子ID、正文、时间、互动、提及信息', dashed: true },
    { type: 'arrow', from: 0, to: 3, y: 500, label: '5. 根据作者ID查询作者资料' },
    { type: 'arrow', from: 3, to: 0, y: 570, label: '6. 用户名、头像、粉丝、排名', dashed: true },
    { type: 'self', at: 0, y: 636, label: '判断是否提及/引用/回复项目' },
    { type: 'self', at: 0, y: 722, label: '整理作者资料和互动数据' },
    { type: 'arrow', from: 0, to: 4, y: 820, label: '7. 按看板+帖子ID去重保存' },
    { type: 'arrow', from: 4, to: 0, y: 890, label: '8. 返回新保存、待 AI 分析的帖子', dashed: true },
    { type: 'note', x: 92, y: 950, w: 1320, h: 92, fill: '#fff8dc', label: '落表字段：tweetId、authorTwitterId、authorHandle、authorFollowersCount、authorGlobalRank、authorCnRank、postCreatedAt、text、normalizedText、source、views/likes/reposts/quotes/replies、rawTweet/rawAuthor' },
  ],
  note: '这一步还不做最终图表，只完成“候选推文 -> 去重帖子事实表”的标准化。',
});

renderDiagram({
  file: '02b-ai-analysis-storage.svg',
  title: '02B 复用旧 AI 能力与项目态度落表时序图',
  subtitle: '调用旧 AI 服务生成摘要/标签/项目态度，并写入本功能字段',
  width: 1500,
  height: 1120,
  actors: [
    { label: 'Jobs进程', type: 'box' },
    { label: '监控看板表', type: 'box' },
    { label: '帖子结果表', type: 'box' },
    { label: 'AI服务', type: 'box' },
    { label: '前端模块', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 2, y: 172, label: '1. 读取还没做项目态度分析的新帖子' },
    { type: 'arrow', from: 2, to: 0, y: 242, label: '2. 正文、来源、作者、排名、互动、已有 ai', dashed: true },
    { type: 'arrow', from: 0, to: 1, y: 312, label: '3. 读取项目背景信息' },
    { type: 'arrow', from: 1, to: 0, y: 382, label: '4. 项目名、官方账号、关键词', dashed: true },
    { type: 'note', x: 92, y: 430, w: 1320, h: 108, fill: '#eef6ff', label: '复用旧 AI 服务接口，不复用 dev.tweet.ai 字段版本；准备 AI 输入：项目名、关键词、帖子正文、命中方式、作者粉丝/排名、互动指标，结果写本功能字段' },
    { type: 'arrow', from: 0, to: 3, y: 606, label: '5. 调用 /ai/project_attitude' },
    { type: 'arrow', from: 3, to: 0, y: 686, label: '6. 返回项目态度分数和摘要', dashed: true },
    { type: 'arrow', from: 0, to: 2, y: 766, label: '7. 写回项目态度和复用标签' },
    { type: 'note', x: 92, y: 828, w: 1320, h: 96, fill: '#f1fff6', label: '写回 EchohuntSocialListeningPosts：sentiment、sentimentScore、sentimentSummaryZh、topics、keywords、aiAnalyzedAt、aiStatus、aiError。AI 失败时 aiStatus=failed，sentiment=unknown，不阻断入库。' },
    { type: 'arrow', from: 2, to: 4, y: 1000, label: '8. 前端展示情绪、摘要、主题、词云', dashed: true },
  ],
  note: '项目态度、摘要、标签都写 Social Listening 自己的表；dev.tweet.ai 不作为最终口径，也不主动改 meta.dev。',
});

renderDiagram({
  file: '02c-aggregate-to-frontend.svg',
  title: '02C 聚合结果落表与前端模块映射时序图',
  subtitle: '后台把单帖结果聚合成前台直接读取的图表、预警、账号动态',
  width: 1500,
  height: 1180,
  actors: [
    { label: 'Jobs进程', type: 'box' },
    { label: '帖子结果表', type: 'box' },
    { label: '关系表', type: 'box' },
    { label: '聚合结果表', type: 'box' },
    { label: 'EchoHunt前端', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 172, label: '1. 读取当前看板时间范围内的帖子' },
    { type: 'arrow', from: 1, to: 0, y: 242, label: '2. 情绪、主题、关键词、互动数据', dashed: true },
    { type: 'self', at: 0, y: 310, label: '计算概览指标：讨论量/账号数/曝光/互动' },
    { type: 'self', at: 0, y: 400, label: '计算趋势、情绪占比、主题、词云' },
    { type: 'arrow', from: 0, to: 2, y: 500, label: '3. 读取关注/取关数据' },
    { type: 'arrow', from: 2, to: 0, y: 570, label: '4. 谁关注谁、发生时间、是否最新', dashed: true },
    { type: 'self', at: 0, y: 642, label: '计算重要账号提及、关注、取关' },
    { type: 'self', at: 0, y: 732, label: '计算预警：讨论量翻倍/负面上升' },
    { type: 'arrow', from: 0, to: 3, y: 832, label: '5. 保存概览和图表数据' },
    { type: 'arrow', from: 0, to: 3, y: 902, label: '6. 保存关键账号动态' },
    { type: 'arrow', from: 0, to: 3, y: 972, label: '7. 保存预警信号' },
    { type: 'arrow', from: 3, to: 4, y: 1060, label: '8. 前端读取概览、账号动态、预警', dashed: true },
    { type: 'note', x: 92, y: 1102, w: 1320, h: 60, fill: '#fff8dc', label: '前端不从 dev.tweet 实时汇总；概览读快照表，关键账号读账号动态表，预警读预警表，帖子列表读帖子结果表。' },
  ],
  note: '这一步决定页面概览指标、趋势图、情绪图、主题、词云、关键账号动态、预警信号。',
});

renderDiagram({
  file: '03-admin-assign-access.svg',
  title: '03 运营分配 EchoHunt 查看权限时序图',
  subtitle: '某个被监控账号/看板可以分配给多个 EchoHunt X 登录账号查看',
  width: 1360,
  height: 880,
  actors: [
    { label: '运营人员', type: 'actor' },
    { label: 'admin-web', type: 'box' },
    { label: 'Admin API', type: 'box' },
    { label: 'AuthCenter', type: 'box' },
    { label: '主业务库', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 190, label: '1. 输入客户 X handle' },
    { type: 'arrow', from: 1, to: 2, y: 238, label: '2. POST /boards/{boardId}/accesses' },
    { type: 'self', at: 2, y: 260, label: '规范化 handle' },
    { type: 'arrow', from: 2, to: 3, y: 334, label: '3. 查 Twitter identity' },
    { type: 'arrow', from: 3, to: 2, y: 382, label: '4. userId/providerSubject/username 或空', dashed: true },
    { type: 'frame', y: 430, h: 214, title: '已登录过 / 未登录过均支持授权', kind: 'Alt' },
    { type: 'arrow', from: 2, to: 4, y: 484, label: '5A. 已登录：写 authCenterUserId + twitterId' },
    { type: 'arrow', from: 2, to: 4, y: 536, label: '5B. 未登录：仅写 twitterHandle' },
    { type: 'arrow', from: 2, to: 4, y: 588, label: '6. INSERT/UPSERT BoardAccesses(active)' },
    { type: 'arrow', from: 2, to: 4, y: 682, label: '7. INSERT AccessAuditLogs(access_grant)' },
    { type: 'arrow', from: 2, to: 1, y: 732, label: '8. 返回授权记录', dashed: true },
    { type: 'arrow', from: 1, to: 0, y: 778, label: '9. 页面展示已授权账号', dashed: true },
  ],
  note: '授权匹配优先级：authCenterUserId -> twitterId(providerSubject) -> twitterHandle(username lower)。',
});

renderDiagram({
  file: '04-echohunt-entry-guard.svg',
  title: '04 EchoHunt 前台入口显示与直接访问时序图',
  subtitle: '只有至少被分配一个被监控账号的 EchoHunt 用户才显示 Social Listening，直接访问无权限则跳回首页',
  width: 1420,
  height: 980,
  actors: [
    { label: 'EchoHunt用户', type: 'actor' },
    { label: 'Next前端', type: 'box' },
    { label: 'Public API', type: 'box' },
    { label: 'Auth中间件', type: 'box' },
    { label: '主业务库', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 190, label: '1. 打开 EchoHunt 首页/Leaderboard' },
    { type: 'arrow', from: 1, to: 2, y: 238, label: '2. GET /me/access-summary' },
    { type: 'arrow', from: 2, to: 3, y: 286, label: '3. 校验 Bearer token' },
    { type: 'arrow', from: 3, to: 2, y: 334, label: '4. user + identities', dashed: true },
    { type: 'arrow', from: 2, to: 4, y: 382, label: '5. 查 active BoardAccesses' },
    { type: 'arrow', from: 4, to: 2, y: 430, label: '6. boardCount/defaultBoardId', dashed: true },
    { type: 'frame', y: 474, h: 190, title: '入口显示判断', kind: 'Alt' },
    { type: 'arrow', from: 2, to: 1, y: 528, label: '7A. count > 0：hasAccess=true', dashed: true },
    { type: 'arrow', from: 1, to: 0, y: 574, label: '8A. 显示 Social Listening 入口', dashed: true },
    { type: 'arrow', from: 2, to: 1, y: 622, label: '7B. count=0/401：hasAccess=false', dashed: true },
    { type: 'divider', y: 700, label: '直接访问 /social-listening' },
    { type: 'arrow', from: 0, to: 1, y: 752, label: '9. 直接打开 /social-listening' },
    { type: 'arrow', from: 1, to: 2, y: 802, label: '10. 再查 access-summary' },
    { type: 'arrow', from: 2, to: 1, y: 852, label: '11. 无权限：401 或 hasAccess=false', dashed: true },
    { type: 'arrow', from: 1, to: 0, y: 902, label: '12. 跳回首页，不展示 Mock/缓存', dashed: true },
  ],
  note: '前端隐藏入口只是体验；所有 Social Listening API 都必须重复校验 BoardAccess。',
});

renderDiagram({
  file: '05-echohunt-view-board.svg',
  title: '05 EchoHunt 用户查看看板数据时序图',
  subtitle: '切换看板、时间范围、Tab 时，全部从主业务库加工表读取',
  width: 1420,
  height: 980,
  actors: [
    { label: 'EchoHunt用户', type: 'actor' },
    { label: 'Social页面', type: 'box' },
    { label: 'Public API', type: 'box' },
    { label: 'Auth中间件', type: 'box' },
    { label: '主业务库', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 190, label: '1. 选择 board / 24H-7D-30D' },
    { type: 'arrow', from: 1, to: 2, y: 238, label: '2. GET /boards/{id}/overview?range=7D' },
    { type: 'arrow', from: 2, to: 3, y: 286, label: '3. 校验 token' },
    { type: 'arrow', from: 3, to: 2, y: 334, label: '4. 返回 user/identities', dashed: true },
    { type: 'arrow', from: 2, to: 4, y: 382, label: '5. 校验 BoardAccess active' },
    { type: 'frame', y: 428, h: 168, title: '权限判断', kind: 'Alt' },
    { type: 'arrow', from: 4, to: 2, y: 480, label: '6A. 无权限', dashed: true },
    { type: 'arrow', from: 2, to: 1, y: 526, label: '7A. 403，前端跳回首页', dashed: true },
    { type: 'arrow', from: 4, to: 2, y: 574, label: '6B. 有权限', dashed: true },
    { type: 'arrow', from: 2, to: 4, y: 638, label: '8. 查看板状态 + 最新概览快照' },
    { type: 'arrow', from: 4, to: 2, y: 686, label: '9. metrics/series/topics/alerts', dashed: true },
    { type: 'arrow', from: 2, to: 1, y: 734, label: '10. 返回 overview 状态', dashed: true },
    { type: 'arrow', from: 1, to: 0, y: 780, label: '11. 渲染概览图表', dashed: true },
    { type: 'divider', y: 824, label: '切换帖子 / 账号动态 / 预警 Tab' },
    { type: 'arrow', from: 1, to: 2, y: 876, label: '12. GET posts/accounts/alerts 分页' },
    { type: 'arrow', from: 2, to: 4, y: 922, label: '13. 校验权限 + 查询帖子/账号动态/预警' },
  ],
  note: '读取表：看板表 / 概览快照表 / 帖子结果表 / 账号动态表 / 预警表 / 关键事件表。',
});

renderDiagram({
  file: '06-manual-refresh.svg',
  title: '06 手动刷新时序图',
  subtitle: '前台用户和运营都可以触发，但需要限流并保证同一看板不并发跑任务',
  width: 1420,
  height: 940,
  actors: [
    { label: '用户/运营', type: 'actor' },
    { label: '前端页面', type: 'box' },
    { label: 'API', type: 'box' },
    { label: 'Redis', type: 'box' },
    { label: '主业务库', type: 'box' },
    { label: 'Jobs进程', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 190, label: '1. 点击 Refresh' },
    { type: 'arrow', from: 1, to: 2, y: 238, label: '2. POST /boards/{id}/refresh' },
    { type: 'arrow', from: 2, to: 4, y: 286, label: '3. 校验 board + 用户权限' },
    { type: 'arrow', from: 2, to: 3, y: 334, label: '4. 查 user/board 冷却 key' },
    { type: 'frame', y: 378, h: 210, title: '限流与并发控制', kind: 'Alt' },
    { type: 'arrow', from: 3, to: 2, y: 430, label: '5A. 命中限流', dashed: true },
    { type: 'arrow', from: 2, to: 1, y: 476, label: '6A. 429 REFRESH_RATE_LIMITED', dashed: true },
    { type: 'arrow', from: 2, to: 4, y: 526, label: '5B. 查是否已有正在处理的任务' },
    { type: 'arrow', from: 4, to: 2, y: 572, label: '6B. 返回当前 job 或空', dashed: true },
    { type: 'arrow', from: 2, to: 4, y: 638, label: '7. 没有 running：创建手动刷新任务' },
    { type: 'arrow', from: 2, to: 3, y: 686, label: '8. 写冷却 key + job-lock' },
    { type: 'arrow', from: 2, to: 1, y: 734, label: '9. 返回 待处理/处理中任务', dashed: true },
    { type: 'arrow', from: 5, to: 4, y: 782, label: '10. 认领 job，执行增量计算' },
    { type: 'arrow', from: 1, to: 2, y: 830, label: '11. 前端轮询 job/board 状态' },
    { type: 'arrow', from: 2, to: 1, y: 878, label: '12. 返回 succeeded/failed/processing', dashed: true },
  ],
  note: '建议限流：前台用户+看板 5 分钟；看板全局 2 分钟；运营 1 分钟；同一看板任意时刻只允许 1 个任务正在处理。',
});

renderDiagram({
  file: '07-export.svg',
  title: '07 帖子导出时序图',
  subtitle: '导出复用列表筛选条件和同一套权限校验，并限制行数/文件大小/频率',
  width: 1360,
  height: 900,
  actors: [
    { label: 'EchoHunt用户', type: 'actor' },
    { label: 'Social页面', type: 'box' },
    { label: 'Export API', type: 'box' },
    { label: 'Redis', type: 'box' },
    { label: '主业务库', type: 'box' },
  ],
  steps: [
    { type: 'arrow', from: 0, to: 1, y: 190, label: '1. 点击导出当前帖子列表' },
    { type: 'arrow', from: 1, to: 2, y: 238, label: '2. GET /posts/export?range&filter&sort' },
    { type: 'arrow', from: 2, to: 4, y: 286, label: '3. 校验 BoardAccess active' },
    { type: 'arrow', from: 2, to: 3, y: 334, label: '4. 检查导出冷却 key' },
    { type: 'frame', y: 382, h: 214, title: '安全限制', kind: 'Alt' },
    { type: 'arrow', from: 3, to: 2, y: 432, label: '5A. 命中频率限制', dashed: true },
    { type: 'arrow', from: 2, to: 1, y: 478, label: '6A. 429 EXPORT_RATE_LIMITED', dashed: true },
    { type: 'arrow', from: 2, to: 4, y: 528, label: '5B. COUNT 符合条件 posts' },
    { type: 'arrow', from: 4, to: 2, y: 574, label: '6B. 返回行数', dashed: true },
    { type: 'arrow', from: 2, to: 1, y: 646, label: '7. 超过 10000 行/20MB：EXPORT_TOO_LARGE', dashed: true },
    { type: 'arrow', from: 2, to: 4, y: 700, label: '8. 未超限：查询白名单字段' },
    { type: 'self', at: 2, y: 724, label: '生成 xlsx/csv 文件' },
    { type: 'arrow', from: 2, to: 4, y: 796, label: '9. 写导出审计日志' },
    { type: 'arrow', from: 2, to: 1, y: 846, label: '10. 返回文件流下载', dashed: true },
  ],
  note: '禁止导出 rawTweet/rawAuthor 中的内部字段、AI prompt、系统字段。',
});

const diagramCards = [
  {
    file: '01-admin-create-monitored-account.svg',
    title: '01 运营新增被监控账号',
    summary: '运营在 admin-web 输入官方 X handle 后，后端先只读查询 meta.dev.twitter_user 确认账号资料，再在主业务库创建默认暂停的被监控看板；管理员点击恢复后才创建初始化任务。',
    bullets: [
      '读取 dev.twitter_user.username/profile/feature/kol，解析头像、粉丝数、华语排名和全球排名。',
      '写入 EchohuntSocialListeningBoards，状态默认 paused。',
      '不自动创建补数据任务；管理员在后台点击恢复后才创建最近7天历史补数据任务。',
    ],
  },
  {
    file: '02-backend-job-computation.svg',
    title: '02 后台任务调度总览',
    summary: '这里先澄清：最近7天初始化和30天回填本质是一件事，都是“历史补数据”；只是先补最近7天让页面尽快可用，再继续从近到远补到30天。',
    bullets: [
      '后台进程先检查哪些看板该更新、哪些任务待执行，再用 Redis 锁住看板，避免重复跑。',
      '每个任务都走同一套流程：把相关帖子筛出来、去重，然后保存到帖子结果表。',
      'AI 分析和聚合计算完成后，再保存概览和图表数据、AccountSignals、Alerts 给前端读取。',
    ],
  },
  {
    file: '02a-post-recall-and-upsert.svg',
    title: '02A 推文召回与落表',
    summary: '后台任务先读取被监控账号配置，再按时间片扫描 meta.dev.tweet，关联 meta.dev.twitter_user 获取作者画像，最终按“看板+帖子ID”去重写入帖子结果表。',
    bullets: [
      '判断帖子是否相关，主要看是否提及官方账号、命中关键词、引用官方帖、回复官方帖。',
      '作者头像、粉丝数、是否中文账号、排名来自 dev.twitter_user。',
      '保存字段包括帖子ID、正文、发布时间、来源类型、作者资料、互动指标和必要原始片段。',
    ],
  },
  {
    file: '02b-ai-analysis-storage.svg',
    title: '02B 复用旧 AI 能力与落表',
    summary: '旧系统已经有摘要、标签、项目态度等 AI 能力；本需求复用旧 AI 服务接口和 payload，但不复用 dev.tweet.ai 字段版本，避免评分/标签口径混杂。',
    bullets: [
      '摘要/标签调用旧 /ai/tweet_summary_media、/ai/tweet_tag_v2；项目态度用项目名+帖子正文调用 /ai/project_attitude。',
      '项目态度接口返回 score + summary；score 可映射为正/中/负，summary 可作为项目相关摘要。',
      '写回帖子结果表：项目态度分数、情绪、项目相关摘要、复用到的标签/主题、分析状态、分析时间、失败原因。',
    ],
  },
  {
    file: '02c-aggregate-to-frontend.svg',
    title: '02C 聚合到前端模块',
    summary: '单条帖子分析完成后，后台再按 24H/7D/30D 汇总成概览、趋势、主题、词云、关键账号动态和预警，前端直接读汇总结果。',
    bullets: [
      '概览快照表服务顶部指标、趋势图、情绪占比、主题和词云。',
      '账号动态表服务高排名账号提及、关注、取关。',
      '预警表服务讨论量异常、负面占比异常、高排名提及、集中负面。',
    ],
  },
  {
    file: '03-admin-assign-access.svg',
    title: '03 运营分配查看权限',
    summary: '运营把某个被监控账号分配给 EchoHunt X 登录账号后，用户才有资格看到 Social Listening 页面。',
    bullets: [
      '优先查询 AuthCenterXhuntIdentities 中 provider=twitter 的登录身份。',
      '已登录用户写 authCenterUserId/twitterId；未登录用户先按 twitterHandle 授权。',
      '授权记录写入 EchohuntSocialListeningBoardAccesses，操作写入审计日志。',
    ],
  },
  {
    file: '04-echohunt-entry-guard.svg',
    title: '04 前台入口显示与直接访问',
    summary: 'EchoHunt 前端通过 access-summary 判断是否展示入口；无授权用户直接访问 /social-listening 会跳回首页。',
    bullets: [
      '前端携带 Bearer token 请求 /me/access-summary。',
      '后端用 authenticateAuthCenterToken 得到 user 和 identities，再查 active BoardAccesses。',
      'boardCount 大于 0 才显示入口；无 token 或无授权时不显示入口且直接访问会跳首页。',
    ],
  },
  {
    file: '05-echohunt-view-board.svg',
    title: '05 前台查看看板数据',
    summary: '用户查看 overview、posts、accounts、alerts 时，每个接口都重复校验授权，然后读取主业务库中的加工结果。',
    bullets: [
      '概览页读取概览快照表和看板状态。',
      '帖子、账号动态、预警分别读取帖子结果表、账号动态表、预警表。',
      '如果授权被撤销，接口返回 403，前端清理状态并跳回首页。',
    ],
  },
  {
    file: '06-manual-refresh.svg',
    title: '06 手动刷新',
    summary: '手动刷新不会直接同步扫库，而是创建或复用后台任务，并通过 Redis 控制频率和并发。',
    bullets: [
      '前台建议 用户+看板 5 分钟限流，看板全局 2 分钟冷却，运营侧 1 分钟冷却。',
      '如果已有正在处理的任务，直接返回当前任务，不重复创建。',
      '没有正在处理的任务时，创建手动刷新任务，由后台进程异步执行增量计算。',
    ],
  },
  {
    file: '07-export.svg',
    title: '07 帖子导出',
    summary: '导出复用帖子列表的同一套筛选、排序和授权校验，并限制导出规模，避免被当成大表下载入口。',
    bullets: [
      '先校验 BoardAccess active，再检查导出冷却。',
      '先 COUNT，超过 10,000 行或约 20MB 时返回 EXPORT_TOO_LARGE。',
      '只导出白名单字段，写导出审计，禁止导出 rawTweet/rawAuthor 内部字段。',
    ],
  },
];


const dataGroups = [
  {
    title: '现有只读数据源：meta 数据库 / dev schema',
    desc: '这些表已经在线上只读从库存在，本需求只读取，不改这些表。',
    rows: [
      ['dev.twitter_user', '现有表', 'meta 只读库 dev schema', 'X 用户/官方账号资料表；用于确认被监控账号、作者画像、粉丝数、头像、是否中文账号、feature.rank.kolCnRank 等排名字段。'],
      ['dev.tweet', '现有表', 'meta 只读库 dev schema', 'X 推文主表；用于召回提及、引用、回复官方账号或关键词的帖子，读取 text/create_time/statistic/info/mention 等字段；ai 字段不作为最终展示/聚合口径。'],
      ['dev.twitter_user_follow', '现有表', 'meta 只读库 dev schema', '通用关注关系表；用于判断谁新增关注了官方账号，或官方账号新增关注了谁。'],
      ['dev.twitter_user_unfollow', '现有表', 'meta 只读库 dev schema', '通用取关关系表；用于判断取关动态，读取 follower_id/following_id/created_at/latest/persist。'],
      ['dev.project_follow', '现有表', 'meta 只读库 dev schema', '项目维度关注关系表；Social Listening 默认纳入项目关系动态。'],
      ['dev.cache', '现有表', 'meta 只读库 dev schema', '排名快照缓存；作为 feature.rank 缺失时的 fallback，例如 backend:score_tag:rank_record:snap_20250606kol。'],
      ['dev.tweet_metric_snapshot', '现有表', 'meta 只读库 dev schema', '推文指标历史快照；可用于更准确的 views/likes/reply/retweet/quote 历史趋势，V1 可作为增强。'],
    ],
  },
  {
    title: '当前系统已有用户与认证表：主业务库',
    desc: '这些表已经在当前 XHunt 主业务库存在，用于识别 EchoHunt 登录用户和 Twitter 身份。',
    rows: [
      ['AuthCenterXhuntUsers', '现有表', '当前 XHunt 主业务库', '认证中心用户主表；Social Listening 前台授权主要使用 id，辅助使用 primaryTwitterId/xhuntUserId/status。'],
      ['AuthCenterXhuntIdentities', '现有表', '当前 XHunt 主业务库', '认证中心登录身份表；provider=twitter 时，providerSubject 是 Twitter user id，username 是 X handle。'],
    ],
  },
  {
    title: '本需求未来新增业务表：主业务库 / Echohunt 前缀',
    desc: '这些表本次需求新增，统一放当前 XHunt 主业务库，不放 meta.dev。',
    rows: [
      ['EchohuntSocialListeningBoards', '新增表', '当前 XHunt 主业务库', '运营维护的被监控账号/看板主表；保存官方账号快照、项目名、关键词、状态、处理进度。'],
      ['EchohuntSocialListeningBoardAccesses', '新增表', '当前 XHunt 主业务库', '看板授权表；控制哪个 EchoHunt 账号能查看哪个被监控账号，是前台是否展示入口的核心依据。'],
      ['EchohuntSocialListeningPosts', '新增表', '当前 XHunt 主业务库', '召回并去重后的帖子事实表；保存作者快照、统计指标、来源类型、情绪、主题、关键词。'],
      ['EchohuntSocialListeningSnapshots', '新增表', '当前 XHunt 主业务库', '24H/7D/30D 聚合快照表；前台概览图表优先读这张表，不实时扫大表。'],
      ['EchohuntSocialListeningAccountSignals', '新增表', '当前 XHunt 主业务库', '关键账号动态表；保存高排名账号提及、关注、取关等信号。'],
      ['EchohuntSocialListeningAlerts', '新增表', '当前 XHunt 主业务库', '预警信号表；保存讨论量异常、负面占比异常、高排名提及、集中负面等结果。'],
      ['EchohuntSocialListeningKeyEvents', '新增表', '当前 XHunt 主业务库', '用户自维护关键事件表；按 authCenterUserId 隔离。'],
      ['EchohuntSocialListeningJobs', '新增表', '当前 XHunt 主业务库', '后台任务状态表；保存历史补数据、增量刷新、手动刷新等任务；先补最近7天，再用同一套逻辑继续补到30天。'],
      ['EchohuntSocialListeningAccessAuditLogs', '新增表', '当前 XHunt 主业务库', '运营操作审计表；记录创建看板、分配权限、撤销权限、暂停恢复等动作。'],
    ],
  },
];

function renderDataMap() {
  return `<section class="data-map">
    <div class="data-map-head">
      <p class="eyebrow">Data Map</p>
      <h2>表与存储位置说明</h2>
      <p>这里把“已经存在的只读表”和“本需求新增表”分开说明，明确 meta 数据库 dev schema 下的现有表、当前主业务库已有表，以及本需求未来新增表。</p>
    </div>
    ${dataGroups.map((group) => `<article class="data-group">
      <div class="group-title">
        <h3>${group.title}</h3>
        <p>${group.desc}</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>表名</th><th>状态</th><th>存储位置</th><th>用途</th></tr></thead>
          <tbody>${group.rows.map((row) => `<tr><td><code>${row[0]}</code></td><td><span class="badge ${row[1] === '新增表' ? 'new' : 'existing'}">${row[1]}</span></td><td>${row[2]}</td><td>${row[3]}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </article>`).join('')}
  </section>`;
}


const frontendFieldRows = [
  ['顶部看板资料', 'EchohuntSocialListeningBoards', 'projectName、officialHandle、projectAvatar、followersCount、globalRank、cnRank、status、已处理到的时间', '页面头部、看板切换、监控状态、最后更新时间。'],
  ['概览指标', 'EchohuntSocialListeningSnapshots.metrics', '帖子数、参与账号数、总曝光、总互动、正面/中性/负面/未知数量、历史是否不完整', '顶部指标卡：讨论量、参与账号、曝光、互动、情绪占比、历史是否完整。'],
  ['趋势图', 'EchohuntSocialListeningSnapshots.volumeSeries / sentimentSeries', 'bucketStart、帖子数、views、positiveCount、neutralCount、negativeCount', '24H/7D/30D 趋势折线/柱状图。'],
  ['主题和词云', 'EchohuntSocialListeningSnapshots.topics / wordCloud', 'topic、count、views、sampleTweetIds、keyword、weight', '主题排行、词云、热门讨论方向。'],
  ['帖子列表', 'EchohuntSocialListeningPosts', 'tweetId、text、postCreatedAt、source、authorHandle、authorName、authorAvatar、viewsCount、likesCount、repostsCount、quotesCount、repliesCount', 'Posts Tab、导出、代表帖、原帖跳转。'],
  ['帖子情绪与摘要', 'EchohuntSocialListeningPosts', 'sentiment、sentimentScore、sentimentSummaryZh、topics、keywords、aiStatus', '帖子情绪标签、负面筛选、主题筛选、AI 摘要。'],
  ['关键账号动态', 'EchohuntSocialListeningAccountSignals', 'signalType、twitterId、handle、followersCount、globalRank、cnRank、occurredAt、mentionCount、postIds、summaryZh', '高排名账号提及、KOL 关注/取关、账号动态列表。'],
  ['预警信号', 'EchohuntSocialListeningAlerts', 'alertType、severity、titleZh、messageZh、currentValue、baselineValue、sampleSize、evidenceTweetIds、status', '预警卡片、异常详情、证据帖子。'],
  ['关键事件', 'EchohuntSocialListeningKeyEvents', 'authCenterUserId、tweetId、eventType、title、eventAt、metadata', '用户自己维护的关键事件；按用户隔离。'],
  ['处理状态', 'EchohuntSocialListeningJobs + EchohuntSocialListeningBoards', '任务类型、状态、进度、startedAt、finishedAt、errorMessage、coverageStartAt、lastSuccessAt', '初始化中、回填中、刷新中、失败提示、最近更新时间。'],
];

const aiPayloadRows = [
  ['项目上下文', 'EchohuntSocialListeningBoards', 'projectName、officialHandle、metadata.keywords / aliases / tokenSymbols', '让 AI 知道这条帖子是在评价哪个项目，避免只看单帖误判。'],
  ['帖子正文', 'EchohuntSocialListeningPosts', 'tweetId、text、normalizedText、source、postCreatedAt、matchedSources', 'AI 判断情绪、主题、摘要的主体内容。'],
  ['作者画像', 'EchohuntSocialListeningPosts 作者快照', 'authorHandle、authorName、authorFollowersCount、authorGlobalRank、authorCnRank、authorIsCn', '辅助判断影响力、语言环境、KOL 权重；不作为唯一情绪依据。'],
  ['互动指标', 'EchohuntSocialListeningPosts', 'viewsCount、likesCount、repostsCount、quotesCount、repliesCount', '辅助聚合影响力和代表帖排序；AI 可用于判断传播强度。'],
  ['AI 输出', '写回 EchohuntSocialListeningPosts', 'projectAttitudeScore、sentiment、sentimentSummaryZh、topics、keywords、aiStatus、aiAnalyzedAt、aiError', '供帖子列表、情绪图、主题、词云、负面预警继续聚合；不混用 dev.tweet.ai 历史字段版本。'],
];

function renderMappingTable(title, desc, rows) {
  return `<article class="data-group">
    <div class="group-title">
      <h3>${title}</h3>
      <p>${desc}</p>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>前端/计算模块</th><th>来源表</th><th>核心字段</th><th>用途</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${row[0]}</td><td><code>${row[1]}</code></td><td>${row[2]}</td><td>${row[3]}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </article>`;
}

function renderComputationMap() {
  return `<section class="data-map computation-map">
    <div class="data-map-head">
      <p class="eyebrow">Computation Map</p>
      <h2>AI 输入、落表字段与前端模块映射</h2>
      <p>后台任务的核心不是“扫到推文就直接给前端”，而是先标准化成帖子结果表；摘要、标签、项目态度统一调用旧 AI 服务并写本功能字段，最后聚合成前端直接读取的概览图表、账号动态和预警。</p>
    </div>
    ${renderMappingTable('送给 AI 的内容', '每条待分析帖子会携带项目上下文、帖子正文、作者画像和互动指标；具体 prompt/接口字段还要按最终 AI 服务确认。', aiPayloadRows)}
    ${renderMappingTable('计算结果如何服务前端', '这些字段决定 Social Listening 页面每个模块的数据来源，前端不直接扫描 meta.dev 大表。', frontendFieldRows)}
  </section>`;
}

function renderCard(card) {
  return `<section class="diagram-card">
    <div class="card-head">
      <div>
        <p class="eyebrow">Sequence Diagram</p>
        <h2>${card.title}</h2>
      </div>
      <a class="open-link" href="./${card.file}" target="_blank">单独打开 SVG</a>
    </div>
    <div class="diagram-wrap"><img src="./${card.file}" alt="${card.title}" /></div>
    <div class="flow-copy">
      <h3>流程说明</h3>
      <p>${card.summary}</p>
      <ul>${card.bullets.map((item) => `<li>${item}</li>`).join('')}</ul>
    </div>
  </section>`;
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EchoHunt Social Listening 时序图</title>
  <style>
    :root {
      --ink: #172033;
      --muted: #66758a;
      --line: #d8e4f2;
      --paper: #fbfdff;
      --card: #ffffff;
      --blue: #2f7fca;
      --blue-soft: #e8f4ff;
      --warn: #fff4c7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 16% 4%, rgba(47,127,202,.16), transparent 28%),
        radial-gradient(circle at 88% 0%, rgba(124,58,237,.10), transparent 26%),
        linear-gradient(180deg, #edf3fa 0%, #f7f9fc 42%, #eef3f8 100%);
    }
    header {
      padding: 42px 48px 28px;
      color: var(--ink);
    }
    .hero {
      max-width: 1180px;
      border: 1px solid rgba(216,228,242,.9);
      border-radius: 28px;
      background: rgba(255,255,255,.74);
      box-shadow: 0 24px 70px rgba(23,32,51,.10);
      padding: 30px 34px;
      backdrop-filter: blur(10px);
    }
    .kicker {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 12px;
      color: var(--blue);
      font-weight: 850;
      letter-spacing: .12em;
      text-transform: uppercase;
      font-size: 12px;
    }
    .kicker::before {
      content: "";
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--blue);
      box-shadow: 0 0 0 7px rgba(47,127,202,.12);
    }
    h1 { margin: 0; font-size: clamp(30px, 4vw, 46px); letter-spacing: -.04em; line-height: 1.05; }
    .hero p { margin: 14px 0 0; color: var(--muted); font-size: 16px; line-height: 1.7; max-width: 860px; }
    .toc {
      margin-top: 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .toc a {
      display: inline-flex;
      padding: 9px 12px;
      border-radius: 999px;
      background: var(--blue-soft);
      color: #215f9d;
      border: 1px solid #c8ddf3;
      text-decoration: none;
      font-weight: 800;
      font-size: 13px;
    }
    main { padding: 0 48px 72px; display: grid; gap: 34px; }
    .data-map {
      background: rgba(255,255,255,.88);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 24px;
      box-shadow: 0 22px 55px rgba(23,32,51,.09);
    }
    .data-map-head {
      max-width: 980px;
      margin-bottom: 18px;
    }
    .data-map-head h2 { margin: 0; font-size: 28px; letter-spacing: -.03em; }
    .data-map-head p { margin: 10px 0 0; color: var(--muted); line-height: 1.75; }
    .data-group + .data-group { margin-top: 22px; }
    .group-title {
      display: grid;
      grid-template-columns: minmax(240px, 330px) 1fr;
      gap: 18px;
      align-items: baseline;
      margin-bottom: 10px;
    }
    .group-title h3 { margin: 0; font-size: 18px; }
    .group-title p { margin: 0; color: var(--muted); line-height: 1.65; }
    .table-wrap {
      overflow: auto;
      border: 1px solid #dce8f5;
      border-radius: 18px;
      background: #fbfdff;
    }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { padding: 13px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid #e6eef7; font-size: 14px; line-height: 1.6; }
    th { color: #42526a; background: #f1f7ff; font-weight: 900; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 800; color: #1f5f9f; background: #eef6ff; padding: 2px 6px; border-radius: 7px; }
    .badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 900; white-space: nowrap; }
    .badge.existing { color: #245b40; background: #dcf8e8; border: 1px solid #b8e9cd; }
    .badge.new { color: #7a4b00; background: #fff1c2; border: 1px solid #f0d98d; }
    .diagram-card {
      background: rgba(255,255,255,.86);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 22px;
      box-shadow: 0 22px 55px rgba(23,32,51,.09);
      overflow: hidden;
    }
    .card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 4px 4px 16px;
    }
    .eyebrow {
      margin: 0 0 6px;
      color: var(--blue);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    h2 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
    .open-link {
      flex: 0 0 auto;
      color: #1f5f9f;
      text-decoration: none;
      font-weight: 850;
      background: #f0f7ff;
      border: 1px solid #c8ddf3;
      border-radius: 999px;
      padding: 10px 14px;
    }
    .open-link:hover { background: #e2f0ff; }
    .diagram-wrap {
      background: #f7faff;
      border: 1px solid #dce8f5;
      border-radius: 22px;
      padding: 12px;
      overflow: auto;
    }
    img {
      width: 100%;
      min-width: 960px;
      height: auto;
      display: block;
      border-radius: 16px;
      background: #f7f9fc;
    }
    .flow-copy {
      margin-top: 18px;
      display: grid;
      grid-template-columns: minmax(180px, 240px) 1fr;
      gap: 18px 28px;
      padding: 20px;
      border-radius: 22px;
      background: linear-gradient(135deg, #f8fbff, #fffdf3);
      border: 1px solid #e3edf7;
    }
    .flow-copy h3 { margin: 0; font-size: 18px; }
    .flow-copy p { margin: 0; color: #334155; line-height: 1.75; font-weight: 650; }
    .flow-copy ul { grid-column: 2; margin: -4px 0 0; padding-left: 20px; color: var(--muted); line-height: 1.75; }
    .flow-copy li + li { margin-top: 4px; }
    @media (max-width: 900px) {
      header, main { padding-left: 18px; padding-right: 18px; }
      .hero { padding: 24px; }
      .card-head { flex-direction: column; }
      .flow-copy { grid-template-columns: 1fr; }
      .flow-copy ul { grid-column: auto; }
      .group-title { grid-template-columns: 1fr; }
      img { min-width: 860px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="hero">
      <p class="kicker">EchoHunt Social Listening</p>
      <h1>可视化时序图</h1>
      <p>面向产品、研发和运营评审：用图片表达各角色动作、后端计算、核心读写表和授权门禁。单张 SVG 可直接复制到技术文档、飞书、语雀或 PRD。</p>
      <nav class="toc">
        ${diagramCards.map((card, idx) => `<a href="#diagram-${idx + 1}">${card.title.replace(/^\d+\s*/, '')}</a>`).join('')}
      </nav>
    </div>
  </header>
  <main>
    ${renderDataMap()}
    ${renderComputationMap()}
    ${diagramCards.map((card, idx) => `<div id="diagram-${idx + 1}">${renderCard(card)}</div>`).join('\n')}
  </main>
</body>
</html>`;
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);

const readme = `# EchoHunt Social Listening 可视化时序图

打开 \`index.html\` 查看全部图。页面顶部包含表与存储位置说明；每张图下面都带有“流程说明”，用于快速解释这条链路做了什么、读写哪些核心数据。

单张图：

1. \`01-admin-create-monitored-account.svg\`：运营新增被监控账号。
2. \`02-backend-job-computation.svg\`：后台任务调度总览。
3. \`02a-post-recall-and-upsert.svg\`：推文召回、作者快照、去重落表。
4. \`02b-ai-analysis-storage.svg\`：复用旧 AI 能力与项目态度落表。
5. \`02c-aggregate-to-frontend.svg\`：聚合结果与前端模块映射。
6. \`03-admin-assign-access.svg\`：运营分配 EchoHunt 查看权限。
7. \`04-echohunt-entry-guard.svg\`：前台入口显示与直接访问门禁。
8. \`05-echohunt-view-board.svg\`：前台查看看板数据。
9. \`06-manual-refresh.svg\`：手动刷新限流与任务触发。
10. \`07-export.svg\`：帖子导出限制与审计。

这些 SVG 是纯静态图片，可以直接放进技术文档、PRD、飞书或语雀。后续要调整文案或样式，修改 \`generate-diagrams.js\` 后重新执行：

\`\`\`bash
node docs/social-listening-sequence-diagrams/generate-diagrams.js
\`\`\`
`;
fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme);

console.log('Generated diagrams in', OUT_DIR);
