// Port of menu/credits (CreditsPage): the scrolling credits over the "striker in the spotlight"
// background with bouncing balls. Original: written by bastiaan konings schuiling 2008 - 2015
// (public domain / Apache-2.0).
//
// PORT: the credits scroll as one DOM column instead of 24 recycled captions; the text of the
// browser port is added at the top. ↑/↓ (or the wheel / a drag) scroll faster or back.

import { dataUrl, h } from '../dom';
import { withNav } from '../nav';
import { back, type Screen } from '../router';
import { HINT_BACK, hintBar, prefersReducedMotion } from '../widgets';

type CreditKind = 'header' | 'sub' | 'credit' | 'space';
interface CreditLine {
  kind: CreditKind;
  text: string;
}

function buildCredits(): CreditLine[] {
  const credits: CreditLine[] = [];
  const AddWhitespace = (n = 1) => {
    for (let i = 0; i < n; i++) credits.push({ kind: 'space', text: '' });
  };
  const AddHeader = (text: string) => {
    AddWhitespace(3);
    credits.push({ kind: 'header', text });
    AddWhitespace();
  };
  const AddSubHeader = (text: string) => {
    AddWhitespace();
    credits.push({ kind: 'sub', text });
  };
  const AddCredit = (text: string) => credits.push({ kind: 'credit', text });

  // ----- this port
  AddCredit('an HTML5 football career game');
  AddHeader('FOOTBALL CAREER');

  AddSubHeader('HTML5 / TypeScript / three.js port, menus & career mode');
  AddCredit('the Football Career contributors');

  AddSubHeader('based on the game');
  AddCredit('Gameplay Football by Bastiaan Konings Schuiling');
  AddCredit('properly decent, 2008 - 2015');

  AddSubHeader('revived as an open source research environment');
  AddCredit('Google Research Football, by the Google Brain team (2019)');

  AddSubHeader('maintained fork this port started from');
  AddCredit('vi3itor/GameplayFootball and its contributors');

  AddSubHeader('libraries used by the port');
  AddCredit('three.js - 3D rendering in the browser');
  AddCredit('TypeScript, Vite');
  AddWhitespace(2);

  // ----- the original credits (menu/credits.cpp InitCreditsContents)
  AddCredit('PROPERLY DECENT presents');
  AddHeader('GAMEPLAY FOOTBALL');
  AddWhitespace(2);

  AddHeader('blunt3d game engine');

  AddSubHeader('programming');
  AddCredit('bastiaan schuiling');

  AddSubHeader("multithreaded 'tasksequence' concept");
  AddCredit('jurian broertjes');
  AddCredit('bastiaan schuiling');

  AddSubHeader('GUI');
  AddCredit('bastiaan schuiling');

  AddSubHeader('loosely based on the Intel paper:');
  AddCredit("'designing the framework of a parallel game engine'");

  AddSubHeader('some maths code inspired by:');
  AddCredit('OGRE graphics rendering engine');

  AddSubHeader('some GUI architecture inspired by:');
  AddCredit('QT cross-platform application and UI framework');

  AddSubHeader('programs/libraries/code used:');
  AddCredit('GNU C++ compiler + mingw32');
  AddCredit('Boost C++ libraries');
  AddCredit('OpenGL - open graphics library');
  AddCredit('OpenAL - open audio library');
  AddCredit('SDL - simple directmedia layer');
  AddCredit('GLEE - OpenGL Easy Extension library');
  AddCredit('sqlite3 - database');
  AddCredit('FastApprox by Paul Mineiro');
  AddCredit('Dev-C++ IDE');
  AddCredit('Sublime Text - best editor ever');

  AddSubHeader('helpful technical papers');
  AddCredit('AMD/ATI, Intel, NVidia');

  AddSubHeader('credit for small pieces of code i used');
  AddCredit('Anthony Williams, sabbac, reedbeta, cm_rollo');
  AddCredit('gathering.tweakers.net');
  AddCredit('www.3dkingdoms.com');
  AddCredit('www.gamedev.net');
  AddCredit('www.euclideanspace.com');
  AddCredit('stackoverflow.com');

  AddSubHeader('very helpful folks @ gathering.tweakers.net');
  AddCredit('.oisyn <-- special mention! thanks for all the help!');
  AddCredit('Zoijar, Soultaker, H!GHGuY,');
  AddCredit('dusty, engelbertus, pedorus,');
  AddCredit('PrisonerOfPain, en iedereen die ik vergeet!');

  AddSubHeader('early morning debugging');
  AddCredit('joris zwart');

  AddHeader('gameplay football');

  AddSubHeader('programming');
  AddCredit('bastiaan schuiling');

  AddSubHeader('graphics, modelling');
  AddCredit('bastiaan schuiling');

  AddSubHeader('audio');
  AddCredit('bastiaan schuiling');
  AddCredit('harm-jan wiechers');

  AddSubHeader('player animations & animation editor coding');
  AddCredit('bastiaan schuiling');

  AddSubHeader('font used');
  AddCredit("'Alegreya Sans SC'");
  AddCredit('by juan pablo del peral (juan@huertatipografica.com.ar)');

  AddSubHeader('libraries/code used:');
  AddCredit('libhungarian by cyrill stachniss');
  AddCredit('perlin noise by ken perlin');

  AddSubHeader('multi-agent positional forcefield concept');
  AddCredit('harmi praagman & alexander woldhek');

  AddSubHeader('miscellaneous architectural support');
  AddCredit('jurian broertjes');

  AddSubHeader('workspace/community for indie game development');
  AddCredit('indietopia groningen');

  AddSubHeader('team emblems');
  AddCredit('TureckiRumun, broxopios, balder, and NLP !');

  AddHeader('now for the fun part!');

  AddSubHeader('mental support');
  AddCredit('jurian broertjes');
  AddCredit('harmi, alexander & stan praagman');
  AddCredit('jorrit grave');
  AddCredit('wouter grevink');
  AddCredit('tessa kusters');
  AddCredit('joey frankhuijzen');
  AddCredit('johan & nia schuiling');
  AddCredit('margit & michel vedder');

  AddSubHeader('want to say hi to:');
  AddCredit('everyone at indietopia!');
  AddCredit('special mention for job talle, because coders rule');
  AddCredit('stephan & amaaaaa, worm & anouk @ irc <3,');
  AddCredit('femke schouten, jan bart leeuw, lennart van luijk,');
  AddCredit('pieter eisenga, albert jan nijburg (SNORT SNORT!!!)');
  AddCredit('ernie getz (mijn geheime muze)');
  AddCredit('het zaterdag/dinsdag voetbal team! hup hup');
  AddCredit('het donderdag futsal team! hup hup');

  AddWhitespace();
  AddCredit('..en zoveel meer mensen die belangrijk zijn (geweest)');
  AddCredit('in mijn leven.. maar jullie passen er niet op! anders');
  AddCredit('blijf ik bezig :p sorry! maar bedankt :)');

  AddSubHeader('life- and project coaching');
  AddCredit('VNN: margriete de jong, for keeping me somewhat sane!');
  AddCredit('3daagse: adriaan, janneke, en de rest!');
  AddCredit('en de VNN groep: eric, menno, jelle, en de rest!');
  AddCredit('chris guikema (life coach), fred vredeveld (sozawe groningen)');

  AddSubHeader('the gameplay football community!!!');
  AddCredit('broxopios, tureckirumun, nlp, balder..');
  AddCredit('everyone basically! i wuvz u <3');
  AddCredit("and sorry i'm such a slowpoke coder!");

  AddSubHeader('lead financial scamming');
  AddCredit('centrale brasschaatse bank');

  AddSubHeader('shouts out to ##club-ubuntu on freenode');
  AddCredit('alexbobp, ldp, ljl, anastasius,');
  AddCredit('lleberg, darkmatter, henux, spec,');
  AddCredit('nocode, avasz, emma, lizzie,');
  AddCredit('gabs, eri, em, kn100, quup,');
  AddCredit('netdaemon, m00se, m0nk, mc44,');
  AddCredit('syrinx_, drderek, and everyone else!');

  AddSubHeader('shouts out to #ranchorelaxo and #properlydecent!');

  AddSubHeader('loud shouts out to ranchorelaxoradio!');

  AddSubHeader('best boy & dolly grip');
  AddCredit('dr. smokey & dj josti');

  AddSubHeader('first international supporter awards goes to');
  AddCredit('victor pardinho from brazil');

  AddSubHeader('1st one to donate!');
  AddCredit('folkert van heusden');

  AddSubHeader('respect for creating a better world!');
  AddCredit('pirate parties international (PPI)');
  AddCredit('electronic frontier foundation (EFF)');
  AddCredit('free software foundation (FSF)');
  AddCredit('bits of freedom (BOF)');
  AddCredit('creative commons (CC)');
  AddCredit('wikipedia');

  AddSubHeader('to the best football club in the world...');
  AddCredit('HUP FC GRONINGEN!');

  AddWhitespace(2);
  AddSubHeader('i dedicate this game to koen konings, my father. RIP');
  AddCredit('~ papa, ik lijk steeds meer op jou! ~');
  AddWhitespace(2);

  AddSubHeader('and finally, to everyone: stay beautiful!');

  AddHeader('THE END');

  AddWhitespace(24);
  AddSubHeader("no really, there's nothing more to say!");

  AddWhitespace(12);
  AddSubHeader('go away! nothing to see here!');

  AddWhitespace(12);
  AddHeader('stop rocking the boat!');

  AddWhitespace(16);
  AddSubHeader("i'm going to call the police, you stalker!");

  AddWhitespace(12);
  AddSubHeader("okay, i'm just going to rewind to the beginning now! hah!");

  AddWhitespace(5);
  AddCredit('PROPERLY DECENT presents');
  AddHeader('GAMEPLAY FOOTBALL');

  AddWhitespace(12);
  AddSubHeader("hah you fell for it, didn't you?");

  AddWhitespace(12);
  AddCredit("okay, now i'm really going to rewind to the beginning. but you");
  AddCredit('will never be sure until you watched all the credits again! muhaha!');

  AddWhitespace(6);
  AddHeader('<3 BYE! <3');
  AddWhitespace(24);
  return credits;
}

const NUM_BALLS = 12;

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function createCreditsScreen(): Screen {
  const lines = buildCredits();
  const column = h(
    'div',
    { class: 'credits-column' },
    lines.map((l) => (l.kind === 'space' ? h('div', { class: 'credit credit--space', 'aria-hidden': 'true' }) : h('div', { class: `credit credit--${l.kind}` }, l.text))),
  );
  const viewport = h('div', { class: 'credits-viewport' }, column);
  const ballLayer = h('div', { class: 'credits-balls', 'aria-hidden': 'true' });
  const ballImg = dataUrl('media/menu/credits/ball.png');

  // C++: ballPos = (random(60, 90), random(-60, -5)), ballMov = (random(-3, 7), random(-40, -10)), in screen percent
  const balls = Array.from({ length: NUM_BALLS }, () => {
    const el = h('div', { class: 'credits-ball', style: `background-image: url("${ballImg}")` });
    ballLayer.appendChild(el);
    return { el, x: random(60, 90), y: random(-60, -5), vx: random(-3, 7), vy: random(-40, -10) };
  });

  const el = h(
    'section',
    { class: 'screen screen--credits' },
    h('div', { class: 'credits-bg', style: `background-image: url("${dataUrl('media/menu/credits/bg.png')}")`, 'aria-hidden': 'true' }),
    ballLayer,
    viewport,
    h('footer', { class: 'screen-footer credits-foot' }, hintBar([{ keys: ['↑', '↓'], pad: ['✥'], label: 'Scroll' }, HINT_BACK]), h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => back(), 'data-nav-default': true }, 'Back')),
  );

  let raf = 0;
  let last = 0;
  let offset = 0; // px scrolled
  let speed = 0; // extra speed from keys (px/s)
  let dragY: number | null = null;
  const baseSpeed = 38; // px/s (C++: 0.11% of the screen height per frame)
  const reduced = prefersReducedMotion();
  let stepAcc = 0;

  const frame = (t: number) => {
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t;
    const loopHeight = column.scrollHeight;
    if (dragY === null) offset += (reduced ? baseSpeed * 0.5 : baseSpeed + speed) * dt;
    speed *= Math.pow(0.1, dt); // decays after a key press
    if (loopHeight > 0) {
      const start = -viewport.clientHeight * 0.85;
      if (offset > loopHeight) offset = start;
      if (offset < start) offset = start;
    }
    column.style.transform = `translate3d(0, ${-offset}px, 0)`;

    // BALLS (fixed 60 Hz steps like the original Process())
    if (!reduced) {
      stepAcc += dt;
      while (stepAcc >= 1 / 60) {
        stepAcc -= 1 / 60;
        for (const b of balls) {
          b.vy += 0.25; // gravity
          if (b.x > 100 - 4 && b.vx > 0) b.vx = -b.vx * 0.7;
          if (b.x < 0 && b.vx < 0) b.vx = -b.vx * 0.7;
          if (b.y > 100 - 5 && b.vy > 20) b.vy = -b.vy * 0.6;
          if (b.y > 100) {
            b.x = random(60, 90);
            b.y = random(-60, -5);
            b.vx = random(-3, 7);
            b.vy = random(-40, -10);
          }
          b.x += b.vx * 0.05;
          b.y += b.vy * 0.05;
        }
      }
      for (const b of balls) b.el.style.transform = `translate3d(${b.x}vw, ${b.y}vh, 0)`;
    }
    raf = requestAnimationFrame(frame);
  };

  viewport.addEventListener(
    'wheel',
    (e) => {
      offset += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
  viewport.addEventListener('pointerdown', (e) => {
    dragY = e.clientY;
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    offset -= e.clientY - dragY;
    dragY = e.clientY;
  });
  const endDrag = () => (dragY = null);
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  return withNav(
    {
      el,
      onShow() {
        offset = -viewport.clientHeight * 0.6;
        last = 0;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      },
      onHide() {
        cancelAnimationFrame(raf);
      },
    },
    {
      onBack: () => back(),
      onAction: (action) => {
        if (action === 'down') speed = Math.min(1200, speed + 420);
        else if (action === 'up') speed = Math.max(-1200, speed - 520);
        else return false;
        return true;
      },
    },
  );
}
