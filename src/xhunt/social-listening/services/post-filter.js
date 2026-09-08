const { Op, fn, col, literal, where: sequelizeWhere } = require("sequelize");
const { normalizeTwitterHandle } = require("../utils/twitter");

function getRecallExcludeAuthorHandles(board) {
  const metadata = board?.metadata && typeof board.metadata === "object" ? board.metadata : {};
  const values = Array.isArray(metadata.recallExcludeAuthorHandles) ? metadata.recallExcludeAuthorHandles : [];
  return Array.from(new Set(values.map(normalizeTwitterHandle).filter(Boolean))).slice(0, 50);
}

function isRecallExcludedAuthor(record, board, field = "authorHandle") {
  const handles = getRecallExcludeAuthorHandles(board);
  return handles.includes(normalizeTwitterHandle(record?.[field]));
}

function applyRecallExcludeAuthorFilter(postWhere, board, field = "authorHandle") {
  const handles = getRecallExcludeAuthorHandles(board);
  if (!handles.length) return postWhere;
  postWhere[Op.and] = [
    ...(postWhere[Op.and] || []),
    {
      [Op.or]: [
        { [field]: null },
        sequelizeWhere(fn("LOWER", col(field)), { [Op.notIn]: handles }),
      ],
    },
  ];
  return postWhere;
}

function applyRecallExcludeInfluentialSignalFilter(signalWhere, board) {
  const handles = getRecallExcludeAuthorHandles(board);
  if (!handles.length) return signalWhere;
  signalWhere[Op.and] = [
    ...(signalWhere[Op.and] || []),
    {
      [Op.or]: [
        { signalType: { [Op.ne]: "influential_mention" } },
        { handle: null },
        sequelizeWhere(fn("LOWER", col("handle")), { [Op.notIn]: handles }),
      ],
    },
  ];
  return signalWhere;
}

// Historical influential alerts retain evidence tweet ids.  Keep those alerts
// out of read results too when one of their evidence tweets was authored by an
// account now excluded from recall.  The board metadata is read in SQL so this
// also works for the cross-board admin alert list.
function applyRecallExcludeAuthorAlertFilter(alertWhere) {
  alertWhere[Op.and] = [
    ...(alertWhere[Op.and] || []),
    literal(`
      NOT (
        "EchohuntSocialListeningAlert"."alertType" = 'influential_mention'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE("EchohuntSocialListeningAlert"."evidenceTweetIds", '[]'::jsonb)) AS evidence(tweet_id)
          JOIN "EchohuntSocialListeningPosts" p
            ON p."boardId" = "EchohuntSocialListeningAlert"."boardId"
           AND p."tweetId" = evidence.tweet_id
          JOIN "EchohuntSocialListeningBoards" b
            ON b."id" = "EchohuntSocialListeningAlert"."boardId"
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(b."metadata"->'recallExcludeAuthorHandles', '[]'::jsonb)) AS excluded(handle)
            WHERE lower(coalesce(p."authorHandle", '')) = lower(regexp_replace(trim(excluded.handle), '^@+', ''))
          )
        )
      )
    `),
  ];
  return alertWhere;
}

module.exports = {
  getRecallExcludeAuthorHandles,
  isRecallExcludedAuthor,
  applyRecallExcludeAuthorFilter,
  applyRecallExcludeInfluentialSignalFilter,
  applyRecallExcludeAuthorAlertFilter,
};
