import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowBlockingSkeleton, shouldShowUpdatingIndicator } from '../src/domain/loadingState.js';

test('initial empty loading blocks with a skeleton while cached refresh keeps content mounted', () => {
  assert.equal(shouldShowBlockingSkeleton(true, []), true);
  assert.equal(shouldShowUpdatingIndicator(true, []), false);
  assert.equal(shouldShowBlockingSkeleton(true, [{ id: 1 }]), false);
  assert.equal(shouldShowUpdatingIndicator(true, [{ id: 1 }]), true);
});

test('loading policy settles cleanly on success, empty state, and failure', () => {
  assert.equal(shouldShowBlockingSkeleton(false, []), false);
  assert.equal(shouldShowUpdatingIndicator(false, [{ id: 1 }]), false);
});
