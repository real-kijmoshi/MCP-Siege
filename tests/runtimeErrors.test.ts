import { describe, expect, it } from 'vitest';
import { isApplicationRuntimeError } from '../src/app/runtimeErrors';

const ORIGIN = 'http://localhost:5173';

describe('global runtime error ownership', () => {
  it('accepts synchronous errors raised by the application origin', () => {
    expect(
      isApplicationRuntimeError(
        new TypeError('broken renderer'),
        `${ORIGIN}/src/rendering/canvas/Renderer.ts`,
        ORIGIN,
      ),
    ).toBe(true);
  });

  it('ignores browser-extension errors instead of stopping the battle', () => {
    const metamaskFailure = new Error('Failed to connect to MetaMask');
    metamaskFailure.stack =
      'Error: Failed to connect to MetaMask\n' +
      '    at chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/inpage.js:1:82492';

    expect(isApplicationRuntimeError(metamaskFailure, undefined, ORIGIN)).toBe(false);
    expect(
      isApplicationRuntimeError(
        new Error('content script failed'),
        'chrome-extension://example/content.js',
        ORIGIN,
      ),
    ).toBe(false);
  });

  it('does not claim an unattributed promise rejection', () => {
    expect(isApplicationRuntimeError(new Error('unknown rejection'), undefined, ORIGIN)).toBe(false);
  });

  it('recognises an application promise rejection by its stack URL', () => {
    const failure = new Error('simulation failed');
    failure.stack = `Error: simulation failed\n    at ${ORIGIN}/assets/index.js:42:7`;
    expect(isApplicationRuntimeError(failure, undefined, ORIGIN)).toBe(true);
  });
});
