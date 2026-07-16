# Crunchbase Company Research Reader Map

Navigation index for `tampermonkey/crunchbase-company-scheduled-reader.user.js`.

## File

- Userscript: `tampermonkey/crunchbase-company-scheduled-reader.user.js`
- Current marked version: `0.1.3`

## Sections

| Section | Purpose | Key functions / symbols |
|---|---|---|
| SECTION 1: CONFIG AND STATE | Panel id, wait timings, localStorage keys | `CONFIG`, `PAGE_WINDOW` |
| SECTION 2: COMMON UTILITIES | Text cleanup, URL normalization, selectors, copy, navigation | `cleanText`, `absoluteUrl`, `slugFromUrl`, `detectPageWarnings`, `waitForSelector` |
| SECTION 3: LIST PAGE PARSER | Parse Crunchbase Discover Companies visible rows | `parseCompanyListRows` |
| SECTION 4: PROFILE PAGE PARSER | Parse `/organization/:slug` profile fields/cards | `parseTileFields`, `parseCompanyProfile`, `parseKeyPeople` |
| SECTION 5: FINANCIAL DETAILS PARSER | Parse `/organization/:slug/financial_details` tables, dedupe rows, parse multi-currency compact amounts | `parseTable`, `parseFinancialDetails`, `parseCompactMoney`, `normalizeFundingRoundRow`, `normalizeInvestorRow`, `buildFinancialNormalized` |
| SECTION 6: DETAIL JOB ORCHESTRATION | Current-tab queue from list -> profile -> financial details | `startDetailCrawl`, `processCurrentJob`, `pauseJob`, `resumeJob` |
| SECTION 7: PANEL UI | Floating controls and status display | `ensurePanel`, `renderPanel` |
| SECTION 8: DEBUG API AND BOOTSTRAP | Console API and automatic resume on detail pages | `CrunchbaseCompanyCollector`, `bootstrap` |

## Manual console API

```js
CrunchbaseCompanyCollector.parseList()
CrunchbaseCompanyCollector.parseCurrentPage()
CrunchbaseCompanyCollector.startDetails()
CrunchbaseCompanyCollector.pause()
CrunchbaseCompanyCollector.resume()
CrunchbaseCompanyCollector.copy()
CrunchbaseCompanyCollector.status()
CrunchbaseCompanyCollector.clear()
```

## Syntax check

```bash
node --check tampermonkey/crunchbase-company-scheduled-reader.user.js
```
