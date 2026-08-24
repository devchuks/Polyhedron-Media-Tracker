import test from 'node:test';
import assert from 'node:assert/strict';
import { applyActivityLifecycle, diaryActionForType, isMeaningfulProgress } from '../src/domain/activityLifecycle.js';

test('first start and first progress populate Started once', () => {
  const first = applyActivityLifecycle({ status: 'planned', dateStarted: null, addedAt: 10 }, {
    status: 'in progress', activityAt: 100, provesConsumption: true,
  });
  const later = applyActivityLifecycle(first, {
    status: 'in progress', activityAt: 200, provesConsumption: true,
  });
  assert.equal(first.dateStarted, 100);
  assert.equal(later.dateStarted, 100);
  assert.equal(later.addedAt, 10);
});

test('direct completion coherently initializes Started and Completed from activity time', () => {
  const completed = applyActivityLifecycle({ status: 'planned', dateStarted: null }, {
    status: 'completed', activityAt: 300, completesItem: true,
  });
  assert.equal(completed.dateStarted, 300);
  assert.equal(completed.dateCompleted, 300);
});

test('clearing Started cannot leave a genuinely consumed or completed item without a start', () => {
  const completed = applyActivityLifecycle({ status: 'planned', dateStarted: null }, {
    status: 'completed', activityAt: 350, explicitStartedAt: null, allowStartedEdit: true, completesItem: true,
  });
  assert.equal(completed.dateStarted, 350);
  assert.equal(completed.dateCompleted, 350);
});

test('explicit Started is preserved and leaving completed clears only current completion', () => {
  const completed = applyActivityLifecycle({ status: 'in progress', dateStarted: 25 }, {
    status: 'completed', activityAt: 300, explicitStartedAt: 999, completesItem: true,
  });
  assert.equal(completed.dateStarted, 25);
  const reopened = applyActivityLifecycle(completed, { status: 'in progress', activityAt: 400 });
  assert.equal(reopened.dateStarted, 25);
  assert.equal(reopened.dateCompleted, null);
});

test('explicit user Started edit can change the tracked start without rewriting Added', () => {
  const edited = applyActivityLifecycle({ status: 'in progress', addedAt: 5, dateStarted: 10 }, {
    status: 'in progress', activityAt: 100, explicitStartedAt: 20, allowStartedEdit: true,
  });
  assert.equal(edited.dateStarted, 20);
  assert.equal(edited.addedAt, 5);
});

test('episode-zero is not meaningful progress and diary actions are type-specific', () => {
  assert.equal(isMeaningfulProgress('S01 E00'), false);
  assert.equal(isMeaningfulProgress('S01 E01'), true);
  assert.equal(diaryActionForType('movies'), 'WATCHED');
  assert.equal(diaryActionForType('manga', true), 'RE-READ');
});
