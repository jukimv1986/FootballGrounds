// Port of menu/ingame/radar.{hpp,cpp}.
// Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// PORT: the original moved one Gui2Image per player (media/menu/radar/p1.png / p2.png) over the
// radar bitmap. Here the pitch and the dots are drawn on a <canvas> inside the view, which is much
// cheaper per frame in the browser, and the team colors are actually used (C++: "todo: use
// colors!"): fill = the team's first color, outline = its second color. Without a DOM it is inert.

import type { Vector3 } from '../../../blunted/base/math/vector3';
import { pitchHalfH, pitchHalfW } from '../../gamedefines';
import type { Match } from '../../onthepitch/match';
import { Gui2View, type Gui2WindowManager } from '../../ui/gui2';

type PlayerList = Parameters<Match['GetActiveTeamPlayers']>[1];

const hasDOM = typeof document !== 'undefined';

function rgb(c: Vector3): [number, number, number] {
  return [c.coords[0], c.coords[1], c.coords[2]];
}

function css(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
}

/** CanvasRenderingContext2D.roundRect with a plain rect fallback for older browsers */
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof c.roundRect === 'function') c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export class Gui2Radar extends Gui2View {
  protected match: Match;
  protected color1_1: Vector3;
  protected color1_2: Vector3;
  protected color2_1: Vector3;
  protected color2_2: Vector3;

  protected canvas: HTMLCanvasElement | null = null;
  protected ctx: CanvasRenderingContext2D | null = null;
  protected background: HTMLCanvasElement | null = null;
  protected resizeObserver: ResizeObserver | null = null;
  protected pixelWidth = 0;
  protected pixelHeight = 0;
  protected dpr = 1;
  /** pitch rectangle inside the canvas (device pixels) */
  protected pitchRect = { x: 0, y: 0, w: 0, h: 0 };

  protected team1players: PlayerList = [];
  protected team2players: PlayerList = [];
  protected teamFill: [string, string] = ['#fff', '#000'];
  protected teamStroke: [string, string] = ['#000', '#fff'];

  constructor(
    windowManager: Gui2WindowManager,
    name: string,
    x_percent: number,
    y_percent: number,
    width_percent: number,
    height_percent: number,
    match: Match,
    color1_1: Vector3,
    color1_2: Vector3,
    color2_1: Vector3,
    color2_2: Vector3,
  ) {
    super(windowManager, name, x_percent, y_percent, width_percent, height_percent);
    this.match = match;
    this.color1_1 = color1_1;
    this.color1_2 = color1_2;
    this.color2_1 = color2_1;
    this.color2_2 = color2_2;
    this.ChooseColors();

    if (hasDOM && this.element) {
      this.element.classList.add('gui2-radar');
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'radar-canvas';
      this.ctx = this.canvas.getContext('2d');
      this.element.appendChild(this.canvas);
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.Resize());
        this.resizeObserver.observe(this.element);
      }
    }

    this.Show();
  }

  /** PORT: similar team colors (most default teams are red) get the away team's second color */
  protected ChooseColors(): void {
    const a1 = rgb(this.color1_1);
    const a2 = rgb(this.color1_2);
    let b1 = rgb(this.color2_1);
    let b2 = rgb(this.color2_2);
    if (colorDistance(a1, b1) < 110) {
      if (colorDistance(a1, b2) >= 110) [b1, b2] = [b2, b1];
      else {
        b1 = colorDistance(a1, [255, 255, 255]) > 200 ? [255, 255, 255] : [20, 24, 40];
        b2 = colorDistance(b1, [0, 0, 0]) > 200 ? [0, 0, 0] : [255, 255, 255];
      }
    }
    const stroke = (fill: [number, number, number], second: [number, number, number]) =>
      colorDistance(fill, second) < 80 ? (fill[0] + fill[1] + fill[2] > 380 ? [0, 0, 0] : [255, 255, 255]) : second;
    this.teamFill = [css(a1), css(b1)];
    this.teamStroke = [css(stroke(a1, a2) as [number, number, number]), css(stroke(b1, b2) as [number, number, number])];
  }

  protected Resize(): void {
    if (!this.canvas || !this.element) return;
    const w = this.element.clientWidth;
    const h = this.element.clientHeight;
    if (w === 0 || h === 0) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.pixelWidth = Math.round(w * this.dpr);
    this.pixelHeight = Math.round(h * this.dpr);
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;

    // the pitch keeps its aspect ratio (C++ stretched radar.png over the view)
    const aspect = (pitchHalfW * 2) / (pitchHalfH * 2);
    let pw = this.pixelWidth;
    let ph = pw / aspect;
    if (ph > this.pixelHeight) {
      ph = this.pixelHeight;
      pw = ph * aspect;
    }
    this.pitchRect = { x: (this.pixelWidth - pw) / 2, y: (this.pixelHeight - ph) / 2, w: pw, h: ph };
    this.DrawBackground();
  }

  protected DrawBackground(): void {
    const bg = document.createElement('canvas');
    bg.width = this.pixelWidth;
    bg.height = this.pixelHeight;
    const c = bg.getContext('2d');
    if (!c) return;
    const { x, y, w, h } = this.pitchRect;
    const r = Math.min(w, h) * 0.04;
    // turf
    c.fillStyle = 'rgba(10, 32, 20, 0.62)';
    c.beginPath();
    roundRect(c, x, y, w, h, r);
    c.fill();
    // stripes
    c.save();
    c.clip();
    c.fillStyle = 'rgba(255, 255, 255, 0.025)';
    for (let i = 0; i < 12; i += 2) c.fillRect(x + (w / 12) * i, y, w / 12, h);
    c.restore();
    // lines (in the 2% margin, like the C++ radar)
    const m = 0.02;
    const lx = x + w * m;
    const ly = y + h * m;
    const lw = w * (1 - 2 * m);
    const lh = h * (1 - 2 * m);
    const sx = lw / (pitchHalfW * 2);
    const sy = lh / (pitchHalfH * 2);
    c.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    c.lineWidth = Math.max(1, this.dpr);
    c.strokeRect(lx, ly, lw, lh);
    c.beginPath();
    c.moveTo(lx + lw / 2, ly);
    c.lineTo(lx + lw / 2, ly + lh);
    c.stroke();
    c.beginPath();
    c.arc(lx + lw / 2, ly + lh / 2, 9.15 * sx, 0, Math.PI * 2);
    c.stroke();
    // penalty and goal areas
    const box = (depth: number, halfWidth: number) => {
      c.strokeRect(lx, ly + lh / 2 - halfWidth * sy, depth * sx, halfWidth * 2 * sy);
      c.strokeRect(lx + lw - depth * sx, ly + lh / 2 - halfWidth * sy, depth * sx, halfWidth * 2 * sy);
    };
    box(16.5, 20.16);
    box(5.5, 9.16);
    // border
    c.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    c.beginPath();
    roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, r);
    c.stroke();
    this.background = bg;
  }

  /** C++ ReloadAvatars: the canvas version has no per-player widgets; kept for API compatibility */
  ReloadAvatars(_teamID: number, _playerCount: number): void {}

  override Process(): void {}

  /** pitch position (meters, y up) -> canvas pixels; same mapping and 2% margin as the C++ radar */
  protected ToCanvas(position: Vector3): { x: number; y: number } {
    const { x, y, w, h } = this.pitchRect;
    const px = position.coords[0] / (pitchHalfW * 2) + 0.5;
    const py = -position.coords[1] / (pitchHalfH * 2) + 0.5;
    return { x: x + (px * 0.96 + 0.02) * w, y: y + (py * 0.96 + 0.02) * h };
  }

  /** updates the dots; called every rendered frame by Match */
  Put(): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas || !this.IsVisible()) return;
    if (this.pixelWidth === 0) {
      this.Resize();
      if (this.pixelWidth === 0) return;
    }
    ctx.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    if (this.background) ctx.drawImage(this.background, 0, 0);

    this.team1players.length = 0;
    this.team2players.length = 0;
    this.match.GetActiveTeamPlayers(0, this.team1players);
    this.match.GetActiveTeamPlayers(1, this.team2players);

    const radius = Math.max(2.5 * this.dpr, this.pitchRect.h * 0.032);
    ctx.lineWidth = Math.max(1, radius * 0.35);
    const teams = [this.team1players, this.team2players];
    for (let teamID = 0; teamID < 2; teamID++) {
      ctx.fillStyle = this.teamFill[teamID];
      ctx.strokeStyle = this.teamStroke[teamID];
      for (const player of teams[teamID]) {
        const p = this.ToCanvas(player.GetPosition());
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // ball on top (C++ ball->SetZPriority(1)); a bit larger when in the air
    const ball = this.match.GetBall().Predict(0);
    const b = this.ToCanvas(ball.Get2D());
    const ballRadius = radius * (0.72 + Math.min(0.6, Math.max(0, ball.coords[2]) * 0.08));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = Math.max(1, ballRadius * 0.45);
    ctx.beginPath();
    ctx.arc(b.x, b.y, ballRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
  }

  override Exit(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.background = null;
    super.Exit();
  }
}
