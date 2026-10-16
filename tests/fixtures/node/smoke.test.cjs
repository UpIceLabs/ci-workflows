const {test} = require('node:test');
const assert = require('node:assert/strict');
test('node runtime executes fixture', () => assert.equal(typeof process.versions.node, 'string'));
