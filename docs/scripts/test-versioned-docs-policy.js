'use strict';

const assert = require('assert/strict');
const { createVersionsConfig, retainVersions } = require('./versioned-docs-policy');

assert.deepStrictEqual(
  retainVersions(['0.4.18', '0.5.68', '0.6.0', '0.5.69', '0.3.2']),
  ['0.6.0', '0.5.69', '0.4.18']
);
assert.deepStrictEqual(
  retainVersions(['0.4.18', '0.5.69', '0.6.0', '0.6.1', '0.7.0']),
  ['0.7.0', '0.6.1', '0.5.69']
);
assert.deepStrictEqual(
  createVersionsConfig(['0.6.0', '0.5.69', '0.4.18']),
  {
    lastVersion: '0.6.0',
    versions: {
      current: { label: 'Next', path: 'next', badge: true },
      '0.6.0': { label: '0.6 (Latest)', path: '', badge: false },
      '0.5.69': { label: '0.5', path: '0.5', badge: false },
      '0.4.18': { label: '0.4', path: '0.4', badge: false },
    },
  }
);

console.log('versioned docs policy: OK');
