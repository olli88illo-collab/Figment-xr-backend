// Express 4 doesn't automatically catch a rejected promise thrown inside
// an async route handler or middleware — without this, a database error
// would just hang the request forever instead of returning a clean 500.
// Wrap any async handler with this before registering it on a route.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
