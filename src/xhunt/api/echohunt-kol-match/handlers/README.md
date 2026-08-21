# EchoHunt KOL Match test handlers

This folder is reserved for optional test-environment handler overrides.

Naming convention:

- `quota.test.js` overrides `GET /quota` for `x-echohunt-app-env: test`.
- `strategy.test.js` overrides `POST /strategy` for `x-echohunt-app-env: test`.
- `ai-search.test.js` overrides `POST /ai-search` for `x-echohunt-app-env: test`.
- `ai-search-stream.test.js` overrides `POST /ai-search/stream` for `x-echohunt-app-env: test`.
- `filter-search.test.js` overrides `POST /filter-search` for `x-echohunt-app-env: test`.
- `kols-lookup.test.js` overrides `GET /kols/lookup` for `x-echohunt-app-env: test`.
- `kols-detail.test.js` overrides `GET /kols/:twitterUserId` for `x-echohunt-app-env: test`.

If a `.test.js` file does not exist, test requests automatically fall back to the production handler while still using test runtime config.

A test handler can export one of these shapes:

```js
module.exports = async function handler(req, res, next) {};
```

or:

```js
module.exports.handler = async function handler(req, res, next) {};
```

or a factory that wraps the production handler:

```js
module.exports.createHandler = function createHandler(productionHandler) {
  return async function testHandler(req, res, next) {
    return productionHandler(req, res, next);
  };
};
```

Use the factory shape when the test route should keep production behavior but still prove it is routed through an isolated `.test.js` file.


## Common dispatcher

KOL Match wires these files through the shared dispatcher at:

```text
src/xhunt/utils/env-handler-dispatch.js
```

Other EchoHunt/XHunt modules can reuse `createRequestEnvDispatcher` with their own `handlersDir`, `getEnv`, and `metaKeyPrefix`.
