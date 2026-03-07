/**
 * Test Calculator Worker
 *
 * Simple addition for verifying function call execution.
 */

async function execute(args) {
  const { a, b } = args;
  return { sum: a + b };
}

module.exports = { execute };
