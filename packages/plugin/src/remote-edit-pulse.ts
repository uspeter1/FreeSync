// Briefly highlights ranges that arrived from other collaborators, so a
// batched remote insert feels like live typing rather than "a paragraph
// appearing." Detects remote-ness by the absence of a CM6 user-event
// annotation on the docChange — local input/paste/undo/redo all set one;
// external file modifications (which is how remote Yjs updates reach CM6
// in this plugin) don't.
//
// Purely visual. Never touches document text, never delays CRDT convergence.

import { Extension, StateEffect, StateField } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view';

interface PulseAdd { id: number; from: number; to: number }
interface PulseRemove { id: number }

const addPulse    = StateEffect.define<PulseAdd>();
const removePulse = StateEffect.define<PulseRemove>();

// Animation duration should match the CSS in styles.css.
const PULSE_MS = 600;
// Cap the number of concurrent pulses so a big paste from a collaborator
// doesn't spew thousands of decorations. Extras collapse into no animation.
const MAX_CONCURRENT = 40;

let pulseIdCounter = 1;

const pulseField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const eff of tr.effects) {
      if (eff.is(addPulse)) {
        const d = Decoration.mark({
          class: 'freesync-remote-insert',
          attributes: { 'data-pulse-id': String(eff.value.id) },
        }).range(eff.value.from, eff.value.to);
        deco = deco.update({ add: [d] });
      }
      if (eff.is(removePulse)) {
        const targetId = String(eff.value.id);
        deco = deco.update({
          filter: (_from, _to, value) =>
            value.spec.attributes?.['data-pulse-id'] !== targetId,
        });
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function remoteEditPulseExtension(): Extension {
  return [
    pulseField,
    ViewPlugin.fromClass(class {
      update(update: ViewUpdate) {
        if (!update.docChanged) return;

        // Collect the insert ranges in this update from all remote
        // transactions. Iterate before dispatching (dispatching inside
        // update() throws — must defer with rAF).
        const inserts: Array<{ id: number; from: number; to: number }> = [];
        for (const tr of update.transactions) {
          if (!tr.docChanged) continue;
          if (isLocalTransaction(tr)) continue;

          tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
            if (inserted.length === 0) return;   // pure delete — nothing to flash
            if (inserts.length >= MAX_CONCURRENT) return;
            inserts.push({ id: pulseIdCounter++, from: fromB, to: toB });
          });
        }
        if (inserts.length === 0) return;

        // Defer the dispatch — CM6 forbids dispatch inside update().
        requestAnimationFrame(() => {
          update.view.dispatch({ effects: inserts.map((i) => addPulse.of(i)) });
          for (const i of inserts) {
            setTimeout(() => {
              update.view.dispatch({ effects: removePulse.of({ id: i.id }) });
            }, PULSE_MS);
          }
        });
      }
    }),
  ];
}

// Local edits (typing, paste, cut, undo, redo, drop, formatting commands) all
// carry a userEvent annotation. Anything else — external file modifications,
// programmatic setValue, our Yjs → disk → Obsidian → CM6 replay — does not.
function isLocalTransaction(tr: { isUserEvent: (name: string) => boolean }): boolean {
  return tr.isUserEvent('input') ||
         tr.isUserEvent('delete') ||
         tr.isUserEvent('undo') ||
         tr.isUserEvent('redo') ||
         tr.isUserEvent('move') ||
         tr.isUserEvent('select');
}

