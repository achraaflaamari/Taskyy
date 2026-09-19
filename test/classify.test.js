'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isTestCommand, isTestTaskGroup, classify } = require('../out/tracker');

describe('classify: test command regex matrix', () => {
  const positives = [
    'npm test',
    'npm run test',
    'yarn test',
    'pnpm test',
    'npx jest src',
    'vitest run',
    'mocha test/',
    'pytest -q',
    'go test ./...',
    'cargo test',
    'dotnet test',
    'phpunit --filter Foo',
  ];
  for (const cmd of positives) {
    it(`detects "${cmd}"`, () => assert.equal(isTestCommand(cmd), true));
  }
  const negatives = [
    'npm run build',
    'node server.js',
    'git commit -m test',
    'echo testing',
    'tsc -p ./',
    '',
  ];
  for (const cmd of negatives) {
    it(`ignores "${cmd || '(empty)'}"`, () => assert.equal(isTestCommand(cmd), false));
  }
  it('matches task group Test', () => {
    assert.equal(isTestTaskGroup('Test'), true);
    assert.equal(isTestTaskGroup({ id: 'test' }), true);
    assert.equal(isTestTaskGroup('Build'), false);
    assert.equal(isTestTaskGroup(undefined), false);
  });
});

describe('classify: precedence test > debug > git > terminal > coding', () => {
  const now = 1_000_000;
  it('test wins over everything', () => {
    assert.equal(classify({ testRunning: true, debugActive: true, lastGitTs: now, lastTerminalTs: now }, now), 'testing');
  });
  it('debug beats git/terminal', () => {
    assert.equal(classify({ testRunning: false, debugActive: true, lastGitTs: now, lastTerminalTs: now }, now), 'debugging');
  });
  it('git beats terminal within 60s', () => {
    assert.equal(classify({ testRunning: false, debugActive: false, lastGitTs: now - 30_000, lastTerminalTs: now }, now), 'git');
  });
  it('git expires after 60s', () => {
    assert.equal(classify({ testRunning: false, debugActive: false, lastGitTs: now - 61_000, lastTerminalTs: now }, now), 'terminal');
  });
  it('terminal expires after 30s → coding', () => {
    assert.equal(classify({ testRunning: false, debugActive: false, lastGitTs: 0, lastTerminalTs: now - 31_000 }, now), 'coding');
  });
  it('defaults to coding', () => {
    assert.equal(classify({ testRunning: false, debugActive: false, lastGitTs: 0, lastTerminalTs: 0 }, now), 'coding');
  });
});
