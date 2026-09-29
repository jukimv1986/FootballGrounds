// Narrative event dialog: title, story text, the choices with their effect hints, then the
// outcome. Uses the shared modal styling and a navigation scope that traps keyboard/gamepad.

import { h } from '../../../ui/dom';
import { pushNavScope } from '../../../ui/nav';
import { rngOf } from '../../core/career';
import { choiceAvailable, pendingEvent, resolveEvent } from '../../core/events';
import type { CareerApp } from '../app';
import { avatar } from '../components';
import { cicon } from '../icons';

const CATEGORY_LABEL: Record<string, string> = {
  club: 'Club',
  media: 'Media',
  life: 'Life',
  family: 'Family',
  romance: 'Romance',
  health: 'Health',
  career: 'Career',
  national: 'National team',
  money: 'Money',
  social: 'Social',
};

const CATEGORY_ICON: Record<string, string> = { club: 'club', media: 'phone', life: 'home', family: 'heart', romance: 'heart', health: 'bandage', career: 'career', national: 'flag', money: 'finances', social: 'people' };

export interface ModalShell {
  overlay: HTMLElement;
  dialog: HTMLElement;
  close(): void;
}

/** a modal overlay in the menu layer with its own nav scope */
export function openModalShell(className: string, content: HTMLElement, onBack?: () => void): ModalShell {
  const host = document.getElementById('app') ?? document.body;
  const dialog = h('div', { class: `modal cc-modal ${className}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const overlay = h('div', { class: 'modal-overlay cc-modal-overlay' }, dialog);
  host.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-in'));
  let closed = false;
  const scope = pushNavScope(overlay, { onBack: () => onBack?.() });
  return {
    overlay,
    dialog,
    close: () => {
      if (closed) return;
      closed = true;
      scope.pop();
      overlay.classList.add('is-out');
      setTimeout(() => overlay.remove(), 180);
    },
  };
}

export function showEventDialog(app: CareerApp): void {
  const s = app.state;
  const p = pendingEvent(s);
  if (!p) return;
  if (document.querySelector('.cc-event')) return;
  const { def, inst } = p;
  const body = h('div', { class: 'cc-event-body modal-body' });
  const content = h(
    'div',
    { class: 'cc-event' },
    h(
      'div',
      { class: 'modal-head' },
      h('span', { class: 'modal-icon' }, cicon(CATEGORY_ICON[def.category] ?? 'info')),
      h('div', {}, h('div', { class: 'modal-kicker' }, CATEGORY_LABEL[def.category] ?? 'Event'), h('h2', { class: 'modal-title' }, def.title(s, inst.ctx))),
    ),
    body,
  );
  const shell = openModalShell('cc-event-modal', content);
  const choices = def.choices.map((c, i) => {
    const ok = choiceAvailable(s, c, inst.ctx);
    const b = h(
      'button',
      {
        class: 'cc-choice',
        type: 'button',
        'data-nav-default': i === 0 ? true : undefined,
        onclick: () => {
          if (ok !== true) return;
          const outcome = resolveEvent(s, i, rngOf(s));
          showOutcome(outcome);
        },
      },
      h('span', { class: 'cc-choice-label' }, c.label),
      c.hint ? h('span', { class: 'cc-choice-hint' }, c.hint) : null,
      ok !== true ? h('span', { class: 'cc-choice-blocked' }, ok) : null,
    );
    if (ok !== true) b.setAttribute('aria-disabled', 'true');
    return b;
  });
  // safety net: never trap the player in an event whose options all became unavailable
  if (choices.every((b) => b.getAttribute('aria-disabled') === 'true')) {
    choices.push(h('button', { class: 'cc-choice', type: 'button', 'data-nav-default': true, onclick: () => showOutcome(resolveEvent(s, 0, rngOf(s))) }, h('span', { class: 'cc-choice-label' }, 'Let it be'), h('span', { class: 'cc-choice-hint' }, 'None of the options is possible right now')));
    choices[0].removeAttribute('data-nav-default');
  }
  body.replaceChildren(
    h('div', { class: 'cc-event-story' }, h('div', { class: 'cc-event-portrait' }, avatar({ skin: s.user.skin, hair: s.user.hair, hairColor: s.user.hairColor, shirt: s.world.clubs[s.user.clubId]?.colors }, 72)), h('p', { class: 'cc-event-text' }, def.text(s, inst.ctx))),
    h('div', { class: 'cc-choices' }, ...choices),
  );
  function showOutcome(text: string) {
    const cont = h('button', { class: 'btn btn--primary', type: 'button', 'data-nav-default': true, onclick: () => done() }, h('span', {}, 'Continue'));
    body.replaceChildren(h('p', { class: 'cc-event-outcome' }, text || 'So be it.'), h('div', { class: 'modal-actions' }, cont));
    requestAnimationFrame(() => cont.focus());
  }
  function done() {
    shell.close();
    app.render();
    // another event may be queued for right now
    if (s.events.pending) setTimeout(() => showEventDialog(app), 200);
  }
}
