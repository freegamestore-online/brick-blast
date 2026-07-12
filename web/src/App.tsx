import { useEffect, useRef } from "react";
import * as LJS from "littlejsengine";
import { Shell } from "./components/Shell";

// ─── Procedural ZzFX sounds — zero asset files ───────────────────────────────
const sndBounce = new LJS.Sound([, , 440, , 0.02, 0.05, , 1.2, , , , , , 0.5]);
const sndBreak  = new LJS.Sound([, , 200, 0.02, 0.05, 0.2, 1, 1.8, , , , , , 0.4]);
const sndLose   = new LJS.Sound([, , 180, , 0.2, 0.4, 1, 0.4, -3, , , , , 0.3]);
const sndStart  = new LJS.Sound([, , 520, , 0.05, 0.15, , 1.5, , 8, , , , 0.3]);
const sndPaddle = new LJS.Sound([, , 320, , 0.01, 0.04, , 2, , , , , , 0.6]);

// ─── World constants ──────────────────────────────────────────────────────────
const W        = 18;   // world half-width  → x in [-W/2, W/2]
const H        = 22;   // world height      → y in [-H/2, H/2]
const HW       = W / 2;
const HH       = H / 2;
const PADDLE_Y = -HH + 1.2;
const BALL_R   = 0.45;
const PADDLE_W = 3.2;
const PADDLE_H = 0.55;

// Brick grid
const BRICK_COLS   = 10;
const BRICK_ROWS   = 6;
const BRICK_W      = 1.5;
const BRICK_H      = 0.65;
const BRICK_PAD    = 0.12;
const BRICKS_TOP_Y = HH - 2.8;

// Row colours (vivid, one per row)
const ROW_COLORS: LJS.Color[] = [
  new LJS.Color(1.0, 0.25, 0.25),   // red
  new LJS.Color(1.0, 0.55, 0.10),   // orange
  new LJS.Color(1.0, 0.90, 0.10),   // yellow
  new LJS.Color(0.25, 0.90, 0.30),  // green
  new LJS.Color(0.20, 0.70, 1.00),  // blue
  new LJS.Color(0.80, 0.30, 1.00),  // purple
];

// ─── Game state ───────────────────────────────────────────────────────────────
type Phase = "start" | "playing" | "gameover";

let phase: Phase    = "start";
let score           = 0;
let lives           = 3;
let highScore       = Number(localStorage.getItem("brickblast_hs") || "0");
let bricks: Brick[] = [];
let ball: Ball | null = null;
let paddle: LJS.EngineObject | null = null;
let paddleTargetX   = 0;
let ballLaunched    = false;

// ─── Brick ────────────────────────────────────────────────────────────────────
class Brick extends LJS.EngineObject {
  row: number;
  alive: boolean;

  constructor(pos: LJS.Vector2, row: number) {
    super(pos, LJS.vec2(BRICK_W, BRICK_H));
    this.row = row;
    this.alive = true;
    this.color = ROW_COLORS[row] ?? new LJS.Color(1, 1, 1);
    this.gravityScale = 0;
    this.setCollision(true, false);
  }

  shatter() {
    if (!this.alive) return;
    this.alive = false;
    const c = ROW_COLORS[this.row] ?? new LJS.Color(1, 1, 1);
    // Particle burst — juicy!
    new LJS.ParticleEmitter(
      this.pos, 0,
      0.5,   // emitSize
      0.0,   // emitTime (burst)
      40,    // emitRate
      Math.PI * 2, // emitConeAngle
      undefined,
      c,                          new LJS.Color(1, 1, 1),
      new LJS.Color(c.r, c.g, c.b, 0), new LJS.Color(1, 1, 1, 0),
      0.35, 0.1, 0.25, 0.08, 0.06,
    );
    sndBreak.play(this.pos);
    this.destroy();
  }
}

// ─── Ball ─────────────────────────────────────────────────────────────────────
const BALL_SPEED = 0.22;

class Ball extends LJS.EngineObject {
  constructor(pos: LJS.Vector2) {
    super(pos, LJS.vec2(BALL_R * 2));
    this.color = new LJS.Color(1, 1, 1);
    this.gravityScale = 0;
    this.velocity = LJS.vec2(0, 0);
    this.setCollision(true, false);
  }

  launch() {
    const angle = (Math.random() * 0.6 + 0.2) * Math.PI; // between ~36° and ~144° upward
    this.velocity = LJS.vec2(Math.cos(angle) * BALL_SPEED, Math.sin(angle) * BALL_SPEED);
  }

  update() {
    super.update();

    if (!ballLaunched) {
      // Sit on paddle
      if (paddle) this.pos = LJS.vec2(paddle.pos.x, PADDLE_Y + PADDLE_H / 2 + BALL_R + 0.05);
      return;
    }

    // Wall bounces (left / right / top)
    if (this.pos.x - BALL_R < -HW) {
      this.pos.x = -HW + BALL_R;
      this.velocity.x = Math.abs(this.velocity.x);
      sndBounce.play(this.pos);
    }
    if (this.pos.x + BALL_R > HW) {
      this.pos.x = HW - BALL_R;
      this.velocity.x = -Math.abs(this.velocity.x);
      sndBounce.play(this.pos);
    }
    if (this.pos.y + BALL_R > HH) {
      this.pos.y = HH - BALL_R;
      this.velocity.y = -Math.abs(this.velocity.y);
      sndBounce.play(this.pos);
    }

    // Paddle collision
    if (paddle) {
      const px = paddle.pos.x;
      const py = PADDLE_Y;
      const dx = this.pos.x - LJS.clamp(this.pos.x, px - PADDLE_W / 2, px + PADDLE_W / 2);
      const dy = this.pos.y - LJS.clamp(this.pos.y, py - PADDLE_H / 2, py + PADDLE_H / 2);
      if (dx * dx + dy * dy < BALL_R * BALL_R && this.velocity.y < 0) {
        // Reflect & add spin based on hit offset
        const hitOffset = (this.pos.x - px) / (PADDLE_W / 2); // -1 to 1
        const spd = Math.hypot(this.velocity.x, this.velocity.y);
        const angle = Math.PI / 2 - hitOffset * 1.1; // ~18° to ~162°
        this.velocity.x = Math.cos(angle) * spd;
        this.velocity.y = Math.abs(Math.sin(angle) * spd);
        this.pos.y = py + PADDLE_H / 2 + BALL_R + 0.01;
        sndPaddle.play(this.pos);
      }
    }

    // Brick collisions
    for (const brick of bricks) {
      if (!brick.alive) continue;
      const bx = brick.pos.x;
      const by = brick.pos.y;
      const hw = BRICK_W / 2 + BALL_R;
      const hh = BRICK_H / 2 + BALL_R;
      if (Math.abs(this.pos.x - bx) < hw && Math.abs(this.pos.y - by) < hh) {
        // Determine collision axis
        const overlapX = hw - Math.abs(this.pos.x - bx);
        const overlapY = hh - Math.abs(this.pos.y - by);
        if (overlapX < overlapY) {
          this.velocity.x *= -1;
          this.pos.x += this.velocity.x > 0 ? overlapX : -overlapX;
        } else {
          this.velocity.y *= -1;
          this.pos.y += this.velocity.y > 0 ? overlapY : -overlapY;
        }
        brick.shatter();
        score += (BRICK_ROWS - brick.row) * 10;
        break; // one brick per frame
      }
    }

    // Ball lost
    if (this.pos.y - BALL_R < -HH) {
      handleBallLost();
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function spawnBricks() {
  bricks.forEach((b) => b.destroy());
  bricks = [];
  const totalW = BRICK_COLS * (BRICK_W + BRICK_PAD) - BRICK_PAD;
  const startX = -totalW / 2 + BRICK_W / 2;
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      const x = startX + col * (BRICK_W + BRICK_PAD);
      const y = BRICKS_TOP_Y - row * (BRICK_H + BRICK_PAD);
      bricks.push(new Brick(LJS.vec2(x, y), row));
    }
  }
}

function spawnPaddleAndBall() {
  if (paddle) paddle.destroy();
  paddle = new LJS.EngineObject(LJS.vec2(0, PADDLE_Y), LJS.vec2(PADDLE_W, PADDLE_H));
  paddle.color = new LJS.Color(0.3, 0.85, 1.0);
  paddle.gravityScale = 0;
  paddleTargetX = 0;

  if (ball) ball.destroy();
  ball = new Ball(LJS.vec2(0, PADDLE_Y + PADDLE_H / 2 + BALL_R + 0.05));
  ballLaunched = false;
}

function handleBallLost() {
  sndLose.play();
  lives -= 1;
  // Explosion at bottom
  new LJS.ParticleEmitter(
    LJS.vec2(ball ? ball.pos.x : 0, -HH + 0.5), 0,
    1, 0, 30, Math.PI,
    undefined,
    new LJS.Color(1, 0.3, 0.2), new LJS.Color(1, 0.8, 0.2),
    new LJS.Color(1, 0.3, 0.2, 0), new LJS.Color(1, 0.8, 0.2, 0),
    0.5, 0.15, 0.3, 0.1, 0.08,
  );
  if (ball) { ball.destroy(); ball = null; }

  if (lives <= 0) {
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("brickblast_hs", String(highScore));
    }
    phase = "gameover";
  } else {
    // Re-serve
    spawnPaddleAndBall();
  }
}

function startGame() {
  score = 0;
  lives = 3;
  phase = "playing";
  spawnBricks();
  spawnPaddleAndBall();
  sndStart.play();
}

// ─── Engine callbacks ─────────────────────────────────────────────────────────
function gameInit() {
  LJS.setCameraPos(LJS.vec2(0, 0));
  LJS.setCameraScale(32);
}

function gameUpdate() {
  if (phase === "start" || phase === "gameover") {
    if (LJS.mouseWasPressed(0) || LJS.keyWasPressed("Space") || LJS.keyWasPressed("Enter")) {
      startGame();
    }
    return;
  }

  // ── Paddle movement ──
  if (paddle) {
    // Mouse / touch: follow pointer directly
    paddleTargetX = LJS.clamp(LJS.mousePos.x, -HW + PADDLE_W / 2, HW - PADDLE_W / 2);
    // Arrow keys add velocity on top
    const kd = Number(LJS.keyIsDown("ArrowRight")) - Number(LJS.keyIsDown("ArrowLeft"));
    paddleTargetX = LJS.clamp(paddleTargetX + kd * 0.35, -HW + PADDLE_W / 2, HW - PADDLE_W / 2);
    paddle.pos.x += (paddleTargetX - paddle.pos.x) * 0.35;
    paddle.pos.y = PADDLE_Y;
  }

  // ── Launch ball ──
  if (!ballLaunched) {
    if (LJS.mouseWasPressed(0) || LJS.keyWasPressed("Space") || LJS.keyWasPressed("ArrowUp")) {
      ballLaunched = true;
      ball?.launch();
    }
  }

  // ── All bricks cleared → next wave ──
  if (bricks.every((b) => !b.alive)) {
    score += 500; // wave bonus
    spawnBricks();
    spawnPaddleAndBall();
    sndStart.play();
  }
}

function gameRender() {
  // Background gradient feel — dark court
  LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(W + 2, H + 2), new LJS.Color(0.05, 0.05, 0.12));

  // Side walls (decorative lines)
  LJS.drawRect(LJS.vec2(-HW - 0.3, 0), LJS.vec2(0.3, H + 2), new LJS.Color(0.15, 0.2, 0.35));
  LJS.drawRect(LJS.vec2( HW + 0.3, 0), LJS.vec2(0.3, H + 2), new LJS.Color(0.15, 0.2, 0.35));

  // Draw paddle with glow
  if (paddle && phase === "playing") {
    LJS.drawRect(paddle.pos, LJS.vec2(PADDLE_W + 0.25, PADDLE_H + 0.25), new LJS.Color(0.3, 0.85, 1.0, 0.25));
    LJS.drawRect(paddle.pos, LJS.vec2(PADDLE_W, PADDLE_H), new LJS.Color(0.3, 0.85, 1.0));
  }

  // Draw ball
  if (ball && phase === "playing") {
    // Glow
    LJS.drawRect(ball.pos, LJS.vec2(BALL_R * 2 + 0.3), new LJS.Color(1, 1, 0.8, 0.25));
    LJS.drawRect(ball.pos, LJS.vec2(BALL_R * 2), new LJS.Color(1, 1, 1));
  }

  // Draw bricks
  for (const brick of bricks) {
    if (!brick.alive) continue;
    const c = ROW_COLORS[brick.row] ?? new LJS.Color(1, 1, 1);
    // Glow halo
    LJS.drawRect(brick.pos, LJS.vec2(BRICK_W + 0.12, BRICK_H + 0.12), new LJS.Color(c.r, c.g, c.b, 0.3));
    // Main brick
    LJS.drawRect(brick.pos, LJS.vec2(BRICK_W, BRICK_H), c);
    // Highlight
    LJS.drawRect(
      LJS.vec2(brick.pos.x, brick.pos.y + BRICK_H * 0.28),
      LJS.vec2(BRICK_W * 0.85, BRICK_H * 0.25),
      new LJS.Color(1, 1, 1, 0.18),
    );
  }

  // ── HUD ──
  LJS.drawText(`${score}`, LJS.vec2(0, HH - 0.8), 1.1, new LJS.Color(1, 1, 1));
  LJS.drawText(`♥ ${lives}`, LJS.vec2(-HW + 1.2, HH - 0.8), 0.9, new LJS.Color(1, 0.4, 0.5));
  LJS.drawText(`Best ${highScore}`, LJS.vec2(HW - 2.0, HH - 0.8), 0.75, new LJS.Color(0.7, 0.9, 1));

  // ── Start screen ──
  if (phase === "start") {
    LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(W + 2, H + 2), new LJS.Color(0.0, 0.0, 0.08, 0.75));
    LJS.drawText("BRICK BLAST", LJS.vec2(0, 3.5), 2.0, new LJS.Color(0.3, 0.85, 1.0));
    LJS.drawText("Break all the bricks!", LJS.vec2(0, 1.2), 0.9, new LJS.Color(0.9, 0.9, 1.0));
    LJS.drawText("Move: mouse or ← →", LJS.vec2(0, -0.2), 0.75, new LJS.Color(0.7, 0.8, 1.0));
    LJS.drawText("Launch: click or Space", LJS.vec2(0, -1.2), 0.75, new LJS.Color(0.7, 0.8, 1.0));
    LJS.drawText("TAP / CLICK TO START", LJS.vec2(0, -3.0), 1.0, new LJS.Color(1, 0.9, 0.2));
    if (highScore > 0) {
      LJS.drawText(`Best: ${highScore}`, LJS.vec2(0, -4.5), 0.85, new LJS.Color(0.8, 1.0, 0.8));
    }
  }

  // ── Game Over screen ──
  if (phase === "gameover") {
    LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(W + 2, H + 2), new LJS.Color(0.0, 0.0, 0.08, 0.75));
    LJS.drawText("GAME OVER", LJS.vec2(0, 3.0), 2.2, new LJS.Color(1, 0.3, 0.3));
    LJS.drawText(`Score: ${score}`, LJS.vec2(0, 0.8), 1.2, new LJS.Color(1, 1, 1));
    LJS.drawText(`Best:  ${highScore}`, LJS.vec2(0, -0.6), 1.0, new LJS.Color(0.3, 1.0, 0.5));
    LJS.drawText("TAP / CLICK TO RETRY", LJS.vec2(0, -2.5), 1.0, new LJS.Color(1, 0.9, 0.2));
  }

  // ── Pre-launch hint ──
  if (phase === "playing" && !ballLaunched) {
    LJS.drawText("Click or Space to launch", LJS.vec2(0, PADDLE_Y - 1.4), 0.7, new LJS.Color(1, 1, 0.5, 0.85));
  }
}

function gameRenderPost() {}
function gameUpdatePost() {}

// ─── React wrapper ────────────────────────────────────────────────────────────
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef   = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || startedRef.current) return;
    startedRef.current = true;
    void LJS.engineInit(
      gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost,
      [], container,
    );
  }, []);

  return (
    <Shell>
      <div ref={containerRef} className="w-full h-full min-h-[400px]" />
    </Shell>
  );
}
