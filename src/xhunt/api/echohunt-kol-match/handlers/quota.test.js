/**
 * EchoHunt KOL Match quota test handler.
 *
 * This file intentionally keeps the same behavior as the production quota
 * handler. Its purpose is to verify that test-environment requests can be
 * routed to an isolated handler file before any experimental logic is added.
 */
function createHandler(productionHandler) {
  return async function quotaTestHandler(req, res, next) {
    return productionHandler(req, res, next);
  };
}

module.exports = {
  createHandler,
};
