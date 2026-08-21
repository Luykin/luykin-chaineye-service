const path = require("path");

function defaultGetEnv(req) {
  return req?.appEnv || req?.echohuntAppEnv?.value || "production";
}

function resolveOptionalModule(modulePath) {
  try {
    return require.resolve(modulePath);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

function loadOptionalHandler(handlersDir, handlerName, options = {}) {
  if (!handlersDir) return null;
  const env = options.env || "test";
  const suffix = options.suffix || `.${env}.js`;
  const modulePath = path.join(handlersDir, `${handlerName}${suffix}`);
  const resolvedPath = resolveOptionalModule(modulePath);
  return resolvedPath ? require(resolvedPath) : null;
}

function normalizeHandler(handlerModule, productionHandler) {
  if (typeof handlerModule === "function") return handlerModule;
  if (typeof handlerModule?.createHandler === "function") return handlerModule.createHandler(productionHandler);
  if (typeof handlerModule?.handler === "function") return handlerModule.handler;
  if (typeof handlerModule?.default === "function") return handlerModule.default;
  return null;
}

function getMetaKey(prefix, name) {
  return `${prefix}${name[0].toUpperCase()}${name.slice(1)}`;
}

function setEnvRouteMeta(req, meta = {}, options = {}) {
  const prefix = options.metaKeyPrefix || "env";
  req[getMetaKey(prefix, "routeName")] = meta.routeName || "";
  req[getMetaKey(prefix, "routeVariant")] = meta.routeVariant || "";
  req[getMetaKey(prefix, "routeEnv")] = meta.routeEnv || "";
  req[getMetaKey(prefix, "envHandlerEnabled")] = !!meta.envHandlerEnabled;
}

function getEnvRouteMeta(req, options = {}) {
  const prefix = options.metaKeyPrefix || "env";
  const routeName = req?.[getMetaKey(prefix, "routeName")] || "";
  const routeVariant = req?.[getMetaKey(prefix, "routeVariant")] || "";
  const routeEnv = req?.[getMetaKey(prefix, "routeEnv")] || "";
  const envHandlerEnabled = !!req?.[getMetaKey(prefix, "envHandlerEnabled")];
  const targetEnv = options.targetEnv || "test";
  return {
    routeName,
    routeVariant,
    routeEnv,
    envHandlerEnabled,
    testHandlerEnabled: targetEnv === "test" ? envHandlerEnabled : undefined,
  };
}

function dispatchByRequestEnv(routeName, productionHandler, options = {}) {
  const targetEnv = options.targetEnv || "test";
  const productionEnv = options.productionEnv || "production";
  const handlerName = options.handlerName || routeName;
  const handlerModule = options.envHandler !== undefined
    ? options.envHandler
    : loadOptionalHandler(options.handlersDir, handlerName, { env: targetEnv, suffix: options.handlerSuffix });
  const envHandler = normalizeHandler(handlerModule, productionHandler);
  const getEnv = options.getEnv || defaultGetEnv;

  return function envRouteDispatch(req, res, next) {
    const requestEnv = String(getEnv(req) || productionEnv);
    const useEnvHandler = requestEnv === targetEnv && typeof envHandler === "function";
    const routeEnv = useEnvHandler ? targetEnv : productionEnv;

    setEnvRouteMeta(req, {
      routeName,
      routeEnv,
      routeVariant: `${routeName}:${routeEnv}`,
      envHandlerEnabled: useEnvHandler,
    }, options);

    const selectedHandler = useEnvHandler ? envHandler : productionHandler;
    try {
      return Promise.resolve(selectedHandler(req, res, next)).catch(next);
    } catch (error) {
      return next(error);
    }
  };
}

function createRequestEnvDispatcher(defaultOptions = {}) {
  return function dispatchWithDefaults(routeName, productionHandler, options = {}) {
    return dispatchByRequestEnv(routeName, productionHandler, {
      ...defaultOptions,
      ...options,
    });
  };
}

module.exports = {
  createRequestEnvDispatcher,
  dispatchByRequestEnv,
  getEnvRouteMeta,
  loadOptionalHandler,
  normalizeHandler,
};
