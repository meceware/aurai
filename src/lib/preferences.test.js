import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefsSchema, promptProblem } from './preferences.js';

test('stored preferences from older versions fall back to defaults instead of breaking', () => {
  const prefs = prefsSchema.parse({ enhanceModel: '!!', confirmAbove: 'lots', lock: 'local', downloadFormat: 'original', qualities: 'high' });
  assert.equal(prefs.enhanceModel, null);
  assert.deepEqual(prefs.qualities, {});
  assert.equal(prefs.downloadFormat, 'jpeg');
  assert.equal(prefs.confirmAbove, 0.25);
  assert.equal(prefs.lock, 'local');
});

test('prompt checks catch a missing request slot and unknown placeholders', () => {
  assert.match(promptProblem('followup', 'Make it nicer.'), /instruction/);
  assert.match(promptProblem('enhance', 'Fix {{colour}}'), /Unknown placeholder/);
  assert.equal(promptProblem('enhance', 'Fix it. {{stats}}'), null);
});
