// Settings (C++ menu/settings, menu/cameramenu, menu/visualoptions): graphics quality, audio
// volume, camera, gameplay and keyboard bindings. Every change is written to GetConfiguration()
// and saved to localStorage right away.

import {
  _default_AccelerationFactor,
  _default_AgilityFactor,
  _default_CameraAngleFactor,
  _default_CameraFOV,
  _default_CameraHeight,
  _default_CameraZoom,
  _default_Difficulty,
  _default_HighPass_AutoDirection,
  _default_HighPass_AutoPower,
  _default_MatchDuration,
  _default_ShortPass_AutoDirection,
  _default_ShortPass_AutoPower,
  _default_Shot_AutoDirection,
  _default_ThroughPass_AutoDirection,
  _default_ThroughPass_AutoPower,
} from '../../game/gamedefines';
import { GetConfiguration, GetControllers } from '../../game/globals';
import { controllerButtonNames, defaultFunctionMapping } from '../../game/hid/gamepad';
import { e_ButtonFunction } from '../../game/hid/ihidevice';
import { KeyCodeLabel, KeyboardConfigKey, buttonFunctionNames, defaultKeyIDs } from '../../game/hid/keyboard';
import { GetConfigUnit, SaveConfiguration } from '../config';
import { h } from '../dom';
import { icon } from '../icons';
import { setNavHandler, withNav } from '../nav';
import { back, type Screen } from '../router';
import { HINT_BACK, HINT_NAVIGATE, HINT_SELECT, HINT_TABS, button, screenFrame, segmentedRow, showModal, showToast, sliderRow } from '../widgets';
import { formatDifficulty, formatMatchDuration } from './matchoptions';

let saveTimer = 0;
function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => SaveConfiguration(), 250);
}

function setReal(name: string, v: number): void {
  GetConfiguration().Set(name, v);
  scheduleSave();
}

interface UnitSetting {
  key: string;
  label: string;
  description?: string;
  def: number;
  format?: (v: number) => string;
}

function unitSliders(settings: UnitSetting[]): { els: HTMLElement[]; reset(): void } {
  const handles = settings.map((s) => ({
    s,
    handle: sliderRow({ label: s.label, description: s.description, value: GetConfigUnit(s.key, s.def), defaultValue: s.def, format: s.format, onInput: (v) => setReal(s.key, v) }),
  }));
  return {
    els: handles.map((x) => x.handle.el),
    reset() {
      for (const { s, handle } of handles) {
        handle.set(s.def);
        GetConfiguration().Set(s.key, s.def);
      }
      scheduleSave();
    },
  };
}

function group(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'settings-group' }, h('h3', { class: 'settings-group-title' }, title), ...children);
}

// ----- tabs

function graphicsTab(): HTMLElement {
  const quality = segmentedRow<string>({
    label: 'Graphics quality',
    description: 'Shadows, anti-aliasing and render resolution. Lower it on phones and older laptops.',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    value: GetConfiguration().Get('graphics_quality', 'medium'),
    onChange: (v) => {
      GetConfiguration().Set('graphics_quality', v);
      scheduleSave();
    },
  });
  return h('div', { class: 'settings-tab' }, group('Display', quality.el), h('p', { class: 'muted small' }, 'Quality changes apply from the next match.'));
}

function audioTab(): HTMLElement {
  const volume = sliderRow({
    label: 'Master volume',
    description: 'Crowd, ball and referee sounds.',
    value: GetConfigUnit('audio_volume', 0.5),
    defaultValue: 0.5,
    onInput: (v) => setReal('audio_volume', v),
  });
  return h('div', { class: 'settings-tab' }, group('Sound', volume.el));
}

function cameraTab(): HTMLElement {
  const sliders = unitSliders([
    { key: 'camera_zoom', label: 'Zoom', description: 'Distance between the camera and the action.', def: _default_CameraZoom },
    { key: 'camera_height', label: 'Height', description: 'How high above the pitch the camera sits.', def: _default_CameraHeight },
    { key: 'camera_fov', label: 'Field of view', description: 'Wider shows more of the pitch.', def: _default_CameraFOV },
    { key: 'camera_anglefactor', label: 'Angle', description: 'How much the camera turns to follow play towards the goals.', def: _default_CameraAngleFactor },
  ]);
  return h(
    'div',
    { class: 'settings-tab' },
    group('Broadcast camera', ...sliders.els),
    h('div', { class: 'settings-tab-actions' }, button('Reset camera', () => (sliders.reset(), showToast('Camera reset to defaults')), { kind: 'ghost', icon: 'refresh' })),
  );
}

function gameplayTab(): HTMLElement {
  const match = unitSliders([
    { key: 'match_difficulty', label: 'Difficulty', description: 'How well the CPU plays when you face it.', def: _default_Difficulty, format: (v) => `${formatDifficulty(v)} · ${Math.round(v * 100)}` },
    { key: 'match_duration', label: 'Match duration', description: 'Real time for 90 minutes of football.', def: _default_MatchDuration, format: formatMatchDuration },
  ]);
  const players = unitSliders([
    { key: 'gameplay_agilityfactor', label: 'Agility', description: 'How quickly players turn.', def: _default_AgilityFactor },
    { key: 'gameplay_accelerationfactor', label: 'Acceleration', description: 'How quickly players reach full speed.', def: _default_AccelerationFactor },
  ]);
  const assists = unitSliders([
    { key: 'gameplay_shortpass_autodirection', label: 'Short pass: aim assist', def: _default_ShortPass_AutoDirection },
    { key: 'gameplay_shortpass_autopower', label: 'Short pass: power assist', def: _default_ShortPass_AutoPower },
    { key: 'gameplay_throughpass_autodirection', label: 'Through pass: aim assist', def: _default_ThroughPass_AutoDirection },
    { key: 'gameplay_throughpass_autopower', label: 'Through pass: power assist', def: _default_ThroughPass_AutoPower },
    { key: 'gameplay_highpass_autodirection', label: 'High pass: aim assist', def: _default_HighPass_AutoDirection },
    { key: 'gameplay_highpass_autopower', label: 'High pass: power assist', def: _default_HighPass_AutoPower },
    { key: 'gameplay_shot_autodirection', label: 'Shot: aim assist', def: _default_Shot_AutoDirection },
  ]);
  return h(
    'div',
    { class: 'settings-tab' },
    group('Match', ...match.els),
    group('Players', ...players.els),
    group('Passing & shooting assistance', ...assists.els),
    h(
      'div',
      { class: 'settings-tab-actions' },
      button(
        'Reset gameplay',
        () => {
          match.reset();
          players.reset();
          assists.reset();
          showToast('Gameplay settings reset to defaults');
        },
        { kind: 'ghost', icon: 'refresh' },
      ),
    ),
  );
}

// keyboard bindings, grouped like the original keyboard page
const BINDING_GROUPS: { title: string; functions: e_ButtonFunction[] }[] = [
  {
    title: 'Movement',
    functions: [e_ButtonFunction.e_ButtonFunction_Up, e_ButtonFunction.e_ButtonFunction_Down, e_ButtonFunction.e_ButtonFunction_Left, e_ButtonFunction.e_ButtonFunction_Right],
  },
  {
    title: 'With the ball',
    functions: [e_ButtonFunction.e_ButtonFunction_ShortPass, e_ButtonFunction.e_ButtonFunction_LongPass, e_ButtonFunction.e_ButtonFunction_HighPass, e_ButtonFunction.e_ButtonFunction_Shot],
  },
  {
    title: 'Without the ball',
    functions: [e_ButtonFunction.e_ButtonFunction_Pressure, e_ButtonFunction.e_ButtonFunction_KeeperRush, e_ButtonFunction.e_ButtonFunction_Sliding, e_ButtonFunction.e_ButtonFunction_TeamPressure],
  },
  {
    title: 'General',
    functions: [
      e_ButtonFunction.e_ButtonFunction_Sprint,
      e_ButtonFunction.e_ButtonFunction_Dribble,
      e_ButtonFunction.e_ButtonFunction_Switch,
      e_ButtonFunction.e_ButtonFunction_Special,
      e_ButtonFunction.e_ButtonFunction_Select,
      e_ButtonFunction.e_ButtonFunction_Start,
    ],
  },
];

/** stored key code of a button function (C++ HIDKeyboard::LoadConfig) */
export function GetKeyBinding(f: e_ButtonFunction): string {
  const stored = GetConfiguration().Get(KeyboardConfigKey(f), '');
  return stored !== '' && !/^-?\d+$/.test(stored) ? stored : defaultKeyIDs[f];
}

function applyBindings(): void {
  // running controllers pick up the new mapping (IHIDevice.LoadConfig reads the configuration)
  for (const c of GetControllers()) c.LoadConfig();
  SaveConfiguration();
}

function controlsTab(): HTMLElement {
  const keyButtons = new Map<e_ButtonFunction, HTMLButtonElement>();
  const refresh = () => {
    for (const [f, btn] of keyButtons) {
      const code = GetKeyBinding(f);
      btn.querySelector('kbd')!.textContent = KeyCodeLabel(code);
      btn.classList.toggle('is-custom', code !== defaultKeyIDs[f]);
    }
  };

  const capture = (f: e_ButtonFunction) => {
    const name = buttonFunctionNames[f];
    let done = false;
    const finish = (code: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      if (code !== null) {
        GetConfiguration().Set(KeyboardConfigKey(f), code);
        applyBindings();
        refresh();
        showToast(`${name}: ${KeyCodeLabel(code)}`, 'success', 1600);
      }
      modal.close();
      keyButtons.get(f)?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') finish(null);
      else if (e.code) finish(e.code);
    };
    const modal = showModal({
      kicker: 'Keyboard',
      title: name,
      className: 'modal--capture',
      body: [h('div', { class: 'capture-key' }, h('kbd', { class: 'kbd-xl' }, '?')), h('p', {}, 'Press the key you want to use.'), h('p', { class: 'muted small' }, `Esc cancels · default: ${KeyCodeLabel(defaultKeyIDs[f])}`)],
      actions: [
        { label: 'Use default', kind: 'default', onClick: () => (finish(defaultKeyIDs[f]), false) },
        { label: 'Cancel', kind: 'ghost', onClick: () => (finish(null), false) },
      ],
      onDismiss: () => finish(null),
    });
    window.addEventListener('keydown', onKey, true);
  };

  const groups = BINDING_GROUPS.map((g) =>
    group(
      g.title,
      h(
        'div',
        { class: 'bindings' },
        g.functions.map((f) => {
          const btn = h(
            'button',
            { type: 'button', class: 'binding', dataset: { function: String(f) }, onclick: () => capture(f) },
            h('span', { class: 'binding-name' }, buttonFunctionNames[f]),
            h('kbd', { class: 'binding-key' }, ''),
          );
          keyButtons.set(f, btn);
          return btn;
        }),
      ),
    ),
  );
  refresh();

  const pad = group(
    'Gamepad (standard layout)',
    h(
      'div',
      { class: 'bindings bindings--readonly' },
      [
        e_ButtonFunction.e_ButtonFunction_ShortPass,
        e_ButtonFunction.e_ButtonFunction_LongPass,
        e_ButtonFunction.e_ButtonFunction_HighPass,
        e_ButtonFunction.e_ButtonFunction_Shot,
        e_ButtonFunction.e_ButtonFunction_Sprint,
        e_ButtonFunction.e_ButtonFunction_Dribble,
        e_ButtonFunction.e_ButtonFunction_Switch,
        e_ButtonFunction.e_ButtonFunction_Start,
      ].map((f) => h('div', { class: 'binding binding--static' }, h('span', { class: 'binding-name' }, buttonFunctionNames[f]), h('kbd', { class: 'binding-key pad' }, controllerButtonNames[defaultFunctionMapping[f]] ?? '?'))),
    ),
    h('p', { class: 'muted small' }, 'Left stick or d-pad moves. Without the ball, A presses, X calls team pressure, B slides and Y sends the keeper out.'),
  );

  return h(
    'div',
    { class: 'settings-tab settings-tab--controls' },
    h('p', { class: 'muted' }, 'Select an action and press a key to rebind it. Actions share keys depending on whether your team has the ball, like the original game.'),
    h('div', { class: 'bindings-grid' }, ...groups),
    h(
      'div',
      { class: 'settings-tab-actions' },
      button(
        'Reset keyboard to defaults',
        () => {
          for (let f = 0; f < e_ButtonFunction.e_ButtonFunction_Size; f++) GetConfiguration().Set(KeyboardConfigKey(f), defaultKeyIDs[f]);
          applyBindings();
          refresh();
          showToast('Keyboard reset to defaults');
        },
        { kind: 'ghost', icon: 'refresh' },
      ),
    ),
    pad,
  );
}

// ----- screen

const TABS: { id: string; label: string; icon: string; build: () => HTMLElement }[] = [
  { id: 'graphics', label: 'Graphics', icon: 'display', build: graphicsTab },
  { id: 'audio', label: 'Audio', icon: 'volume', build: audioTab },
  { id: 'camera', label: 'Camera', icon: 'camera', build: cameraTab },
  { id: 'gameplay', label: 'Gameplay', icon: 'ball', build: gameplayTab },
  { id: 'controls', label: 'Controls', icon: 'keyboard', build: controlsTab },
];

let lastTab = 0;

export function createSettingsScreen(initialTab?: string): Screen {
  let active = initialTab ? Math.max(0, TABS.findIndex((t) => t.id === initialTab)) : lastTab;
  const panel = h('div', { class: 'panel settings-panel', role: 'tabpanel' });
  const tabButtons = TABS.map((t, i) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { tab: t.id }, onclick: () => select(i, false) }, icon(t.icon), h('span', {}, t.label)),
  );
  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings' }, ...tabButtons);

  const select = (i: number, focusTab: boolean) => {
    active = (i + TABS.length) % TABS.length;
    lastTab = active;
    tabButtons.forEach((b, j) => {
      b.classList.toggle('is-active', j === active);
      b.setAttribute('aria-selected', String(j === active));
    });
    panel.replaceChildren(TABS[active].build());
    panel.scrollTop = 0;
    if (focusTab) tabButtons[active].focus({ preventScroll: true });
    tabButtons[active].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  // ←/→ on the tab bar switch tabs
  for (const b of tabButtons)
    setNavHandler(b, (action) => {
      if (action === 'left' || action === 'right') {
        select(active + (action === 'left' ? -1 : 1), true);
        return true;
      }
      return false;
    });
  select(active, false);
  tabButtons[active].setAttribute('data-nav-default', '');

  const el = screenFrame({
    id: 'settings',
    kicker: 'Options',
    title: 'Settings',
    onBack: () => back(),
    background: 'city',
    body: [tabBar, panel],
    hints: [HINT_TABS, HINT_NAVIGATE, HINT_SELECT, HINT_BACK],
  });

  return withNav(
    {
      el,
      onHide() {
        window.clearTimeout(saveTimer);
        SaveConfiguration();
      },
    },
    {
      onBack: () => back(),
      onAction: (action) => {
        if (action === 'prev' || action === 'next') {
          select(active + (action === 'prev' ? -1 : 1), true);
          return true;
        }
        return false;
      },
    },
  );
}
