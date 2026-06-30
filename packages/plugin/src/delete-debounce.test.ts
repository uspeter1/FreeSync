// Run with: npx tsx --test packages/plugin/src/delete-debounce.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { DeleteDebouncer } from './delete-debounce';

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Recorder {
  propagated: string[];
  filesOnDisk: Set<string>;
  debouncer: DeleteDebouncer;
}

function makeDebouncer(delayMs = 30): Recorder {
  const r: Recorder = {
    propagated: [],
    filesOnDisk: new Set<string>(),
    debouncer: null!,
  };
  r.debouncer = new DeleteDebouncer({
    delayMs,
    fileExists: (path) => r.filesOnDisk.has(path),
    propagate: (path) => r.propagated.push(path),
  });
  return r;
}

test('schedule then nothing → propagates after delay', async () => {
  const r = makeDebouncer(20);
  r.debouncer.schedule('foo.md');
  assert.equal(r.propagated.length, 0, 'should not propagate yet');
  await wait(50);
  assert.deepEqual(r.propagated, ['foo.md']);
  assert.equal(r.debouncer.pendingCount(), 0, 'timer cleared after fire');
});

test('schedule then cancel before delay → no propagation', async () => {
  const r = makeDebouncer(20);
  r.debouncer.schedule('foo.md');
  await wait(10);
  const cancelled = r.debouncer.cancel('foo.md');
  assert.equal(cancelled, true);
  await wait(40);
  assert.deepEqual(r.propagated, [], 'must not propagate after cancel');
  assert.equal(r.debouncer.pendingCount(), 0);
});

test('cancel returns false when nothing was pending', () => {
  const r = makeDebouncer();
  assert.equal(r.debouncer.cancel('nothing.md'), false);
});

test('fire-time re-check: file reappears via untracked path → does not propagate', async () => {
  const r = makeDebouncer(20);
  r.debouncer.schedule('foo.md');
  // Simulate the file coming back on disk WITHOUT calling cancel() — e.g.
  // a remote restore via the manifest observer that somehow didn't route
  // through cancel(). The fire-time re-check should save us.
  r.filesOnDisk.add('foo.md');
  await wait(50);
  assert.deepEqual(r.propagated, [], 'fire-time check must abort propagation');
});

test('fire-time re-check passes when file really is gone', async () => {
  const r = makeDebouncer(20);
  r.filesOnDisk.add('foo.md');     // file was on disk before delete
  r.debouncer.schedule('foo.md');
  r.filesOnDisk.delete('foo.md');  // delete really happened
  await wait(50);
  assert.deepEqual(r.propagated, ['foo.md']);
});

test('re-schedule same path → only latest timer fires once', async () => {
  const r = makeDebouncer(30);
  r.debouncer.schedule('foo.md');
  await wait(10);
  r.debouncer.schedule('foo.md');  // restart the timer
  await wait(25);                   // would've fired the first timer by now
  assert.deepEqual(r.propagated, [], 'first timer must have been cleared');
  await wait(15);                   // total ~50ms since 2nd schedule (30ms+)
  assert.deepEqual(r.propagated, ['foo.md']);
});

test('multiple paths are independent', async () => {
  const r = makeDebouncer(20);
  r.debouncer.schedule('a.md');
  r.debouncer.schedule('b.md');
  r.debouncer.schedule('c.md');
  assert.equal(r.debouncer.pendingCount(), 3);
  r.debouncer.cancel('b.md');
  assert.equal(r.debouncer.pendingCount(), 2);
  await wait(50);
  assert.deepEqual(r.propagated.sort(), ['a.md', 'c.md']);
});

test('cancelAll wipes all pending timers', async () => {
  const r = makeDebouncer(20);
  r.debouncer.schedule('a.md');
  r.debouncer.schedule('b.md');
  r.debouncer.schedule('c.md');
  assert.equal(r.debouncer.pendingCount(), 3);
  r.debouncer.cancelAll();
  assert.equal(r.debouncer.pendingCount(), 0);
  await wait(50);
  assert.deepEqual(r.propagated, []);
});

test('hasPending reflects current state', () => {
  const r = makeDebouncer(50);
  assert.equal(r.debouncer.hasPending('foo.md'), false);
  r.debouncer.schedule('foo.md');
  assert.equal(r.debouncer.hasPending('foo.md'), true);
  r.debouncer.cancel('foo.md');
  assert.equal(r.debouncer.hasPending('foo.md'), false);
});

test('OneDrive transient scenario: delete, then create within window', async () => {
  // Simulates the actual production case that lost the user's files.
  const r = makeDebouncer(30);
  r.filesOnDisk.add('cheatsheet.md');

  // OneDrive blips the file off disk
  r.filesOnDisk.delete('cheatsheet.md');
  r.debouncer.schedule('cheatsheet.md');

  // OneDrive puts it back ~500ms later (test-scaled to 10ms)
  await wait(10);
  r.filesOnDisk.add('cheatsheet.md');
  r.debouncer.cancel('cheatsheet.md');   // onCreate handler calls this

  // Wait past the original delay window
  await wait(50);
  assert.deepEqual(r.propagated, [], 'transient must not have propagated');
  assert.equal(r.debouncer.pendingCount(), 0);
});

test('real delete scenario: delete with no re-create propagates', async () => {
  const r = makeDebouncer(20);
  r.filesOnDisk.add('doomed.md');
  r.filesOnDisk.delete('doomed.md');
  r.debouncer.schedule('doomed.md');
  await wait(50);
  assert.deepEqual(r.propagated, ['doomed.md']);
});

test('rapid delete/create/delete: only final delete propagates', async () => {
  const r = makeDebouncer(30);
  r.filesOnDisk.add('flicker.md');

  // First delete
  r.filesOnDisk.delete('flicker.md');
  r.debouncer.schedule('flicker.md');
  await wait(10);

  // Create
  r.filesOnDisk.add('flicker.md');
  r.debouncer.cancel('flicker.md');
  await wait(10);

  // Real delete
  r.filesOnDisk.delete('flicker.md');
  r.debouncer.schedule('flicker.md');

  await wait(50);
  assert.deepEqual(r.propagated, ['flicker.md']);
});
