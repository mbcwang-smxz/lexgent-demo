// Test worker for integration testing
function execute(params) {
  return { result: params.message || 'test' };
}
module.exports = { execute };
