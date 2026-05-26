# RootData Fundraising Scheduled Reader Map

This file is a lightweight navigation index for `rootdata-fundraising-scheduled-reader.user.js`.
It is intentionally documentation-only: the userscript remains a single Tampermonkey file.

## File

- Userscript: `tampermonkey/rootdata-fundraising-scheduled-reader.user.js`
- Current marked version: `0.7.0`

## Sections

| Section | Approx line | Purpose | Key functions / symbols |
|---|---:|---|---|
| SECTION 1: CONFIG AND GLOBAL STATE | ~25 | Endpoints, schedule config, limits, storage keys, global window bootstrap | `CONFIG`, `PAGE_WINDOW` |
| SECTION 2: COMMON UTILITIES | ~99 | Text cleanup, URL normalization, time helpers, localStorage helpers | `cleanText`, `absoluteUrl`, `canonicalRootDataDetailUrl`, `nowIso`, `safeJsonParse`, `getPendingJob` |
| SECTION 3: JOB STORAGE AND COMPACTION HELPERS | ~241 | Compact detail/recrawl job state for localStorage | `compactStatsForStorage`, `compactRecrawlJobForStorage`, `compactDetailJobForStorage` |
| SECTION 4: FUNDRAISING LIST PARSER | ~345 | Parse `/fundraising` homepage table rows | `parseEntityIdFromK`, `normalizeEntityName`, `parseInvestorCell`, `parseFundraisingRows`, `detectBlockedPage` |
| SECTION 5: DETAIL PAGE FUNDRAISING / INVESTMENT PARSERS | ~1134 | Parse project detail Fundraising section, Investors/Rounds tabs, Lead markers, and Portfolio/Investment sections | `parseInitialInvestors`, `parseRoundsInvestors`, `mergeInvestorData`, `clickRoundsTab`, `scrapeInvestedProjectsFromDetail` |
| SECTION 6: DETAIL BASIC PROFILE PARSER | ~1490 | Parse detail page basic fields and assemble final detail payload | `parseBasicDetail`, `parseDetailDocument`, `crawlDetailPage`, `crawlCurrentDetailPage` |
| SECTION 7: API CLIENT / SERVER SUBMISSION | ~1744 | Backend submission endpoints and request wrapper | `requestJson`, `submitData`, `submitDetailCleanup`, `submitDetailData`, `submitDetailFailure`, `fetchDetailQueue` |
| SECTION 8: DETAIL / RECRAWL JOB ORCHESTRATION | ~1953 | Detail queue execution, recrawl batching, current-tab continuation, sub-detail crawl | `runRecrawlBatchJob`, `runDetailBatchJob`, `crawlDetailsForRows`, `startBatchedDetailsForRows` |
| SECTION 9: PANEL UI AND PAGE-LEVEL WORKFLOWS | ~2869 | Floating status panel, idle countdown, manual scrape workflow, scheduled loop, bootstrapping | `getNextScheduleInfo`, `formatDuration`, `renderPanel`, `updateIdleCountdown`, `startRefreshThenScrape`, `scrapeCurrentPage`, `initScheduleLoop`, `bootstrap` |
| SECTION 10: DEBUG / CONSOLE API | ~3233 | Public console API exposed as `RootDataFundraisingCollector` | `exposeDebugApi`, `cleanAndRecrawlHomepageTop`, `recrawlDetails`, `resumeRecrawlDetails`, `debugDetail`, `status` |

## Common edit targets

### Homepage list parsing

Use when RootData `/fundraising` table DOM changes.

- Section: 4
- Main function: `parseFundraisingRows`
- Related helpers: `findProjectLink`, `parseInvestorCell`, `normalizeEntityName`

### Lead investor parsing

Use when RootData project detail Fundraising tabs change.

- Section: 5
- Main functions:
  - `hasExplicitLeadMarker`
  - `isLeadInvestorElement`
  - `parseInitialInvestors`
  - `parseRoundsInvestors`
  - `mergeInvestorData`
- Important behavior: Lead markers may exist only on the `Investors` tab, so the script caches Investors data before switching to `Rounds`.

### Detail page basics / social links

Use when logo, X/Twitter, website, LinkedIn, team members, or project title parsing breaks.

- Section: 6
- Main functions:
  - `parseBasicDetail`
  - `parseTeamMembers`
  - `parseLegacyTeamMembers`
  - `parseModernTeamMembers`
  - `parseDetailDocument`
- Team parsing supports both old `.team_member/.team-member` cards and new `section` blocks with `h2=Team` plus `/member/` links.


### Idle countdown in floating panel

Use when changing how the panel displays the next scheduled auto run.

- Section: 9
- Main functions:
  - `getNextScheduleInfo`
  - `formatDuration`
  - `renderPanel`
  - `updateIdleCountdown`
- Config:
  - `CONFIG.scheduleBeijingTimes`
  - `CONFIG.idleCountdownRefreshMs`
- Behavior: countdown appears only for idle-like panel states (`idle`, `copied`, `copy_failed`) and updates every second while on the Fundraising page.

### Cleanup + recrawl current homepage top projects

Use when the latest Fundraising homepage items need a clean rebuild.

- Section: 10
- Console command:

```js
await RootDataFundraisingCollector.cleanAndRecrawlHomepageTop(30, {
  batchSize: 10,
  maxSub: 0
});
```

This calls backend cleanup, re-imports homepage rows, then recrawls details.

### Manual recrawl arbitrary items

Use when a custom list of project/investor detail pages needs recrawl.

- Section: 10
- Console command:

```js
await RootDataFundraisingCollector.recrawlDetails(items, {
  batchSize: 10,
  maxSub: 0,
  forceRefreshInvestmentRelationships: true,
  forceRefreshInvestedRelationships: true
});
```

### Backend API submission

Use when request payload or endpoint changes.

- Section: 7
- Functions:
  - `submitData`
  - `submitDetailCleanup`
  - `submitDetailData`
  - `submitDetailFailure`

## Notes for future AI edits

1. Prefer editing the smallest section that owns the behavior.
2. Do not split the userscript into modules unless a build step is added first.
3. After edits, run:

```bash
node --check tampermonkey/rootdata-fundraising-scheduled-reader.user.js
```

4. If line numbers drift, update this map after major edits.
