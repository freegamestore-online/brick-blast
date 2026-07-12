import { useEffect, useRef } from "react";
import * as LJS from "littlejsengine";
import { Shell } from "./components/Shell";

// ─── World constants ──────────────────────────────────────────────────────────
const WORLD_W = 16;   // half-width  → x in [-WORLD_W, WORLD_W]
const WORLD_H = 11;   // half-height → y in [-WORLD_H, WORLD_H]
const CAM_SCALE = 48;

// Paddle
const PADDLE_Y = -9.0;
const PADDLE_W = 3.2;
const PADDLE_H = 0.55;
const PADDLE_SPEED = 0.35;

// Ball
const BALL_R = 0.38;
const BALL_SPEED_INIT = 0.22;
const BALL_SPEED_MAX = 0.42;

// Bricks
const BRICK_COLS = 10;
const BRICK_ROWS = 6;
const BRICK_W = 2.6;
const BRICK_H = 0.8;
const BRICK_GAP = 0.18;
const BRICK_TOP = 6.8;   // y of top brick row centre

// ─── Procedural sounds (ZzFX) ─────────────────────────────────────────────────
const sndBounce = new LJS.Sound([, , 440, , 0.02, 0.04, , 1.8, , , , , , 0.5]);
const sndBrick  = new LJS.Sound([, , 320, 0.01, 0.05, 0.15, 1, 1.6, , , , , , , , 0.3]);
const sndLose   = new LJS.Sound([, , 180, , 0.15, 0.5, 1, 0.4, -3, , , , , 0.3]);
const sndWin    = new LJS.Sound([, , 600, , 0.1, 0.35, , 1.5, , 8, 300, 0.06, 0.3]);
const sndStart  = new LJS.Sound([, , 500, , 0.06, 0.18, , 2, , , 200, 0.05]);

// ─── Colour palette for brick rows ───────────────────────────────────────────
const ROW_COLORS: LJS.Color[] = [
  new LJS.Color(1.0, 0.25, 0.25),   // red
  new LJS.Color(1.0, 0.55, 0.1),    // orange
  new LJS.Color(1.0, 0.9,  0.1),    // yellow
  new LJS.Color(0.2, 0.85, 0.3),    // green
  new LJS.Color(0.2, 0.7,  1.0),    // blue
  new LJS.Color(0.75, 0.3, 1.0),    // purple
];

// ─── Game state ───────────────────────────────────────────────────────────────
type Phase = "start" | "playing" | "dead" | "won";

let phase: Phase = "start";
let score = 0;
let lives = 3;
let highScore = Number(localStorage.getItem("brickblast_hs") || "0");
let bricks: Brick[] = [];
let ball: Ball | null = null;
let paddle: LJS.EngineObject | null = null;
let ballStuck = true;   // ball glued to paddle until first click/tap/space

// ─── Brick class ─────────────────────────────────────────────────────────────
class Brick extends LJS.EngineObject {
  row: number;
  hp: number;
  maxHp: number;
  baseColor: LJS.Color;

  constructor(pos: LJS.Vector2, row: number, hp: number) {
    super(pos, LJS.vec2(BRICK_W - BRICK_GAP, BRICK_H - BRICK_GAP));
    this.row = row;
    this.hp = hp;
    this.maxHp = hp;
    this.baseColor = ROW_COLORS[row % ROW_COLORS.length] ?? new LJS.Color(1, 1, 1);
    this.color = this.baseColor;
    this.gravityScale = 0;
    this.mass = 0; // static
  }

  hit() {
    this.hp -= 1;
    // Flash white briefly
    this.color = new LJS.Color(1, 1, 1);
    if (this.hp <= 0) {
      this.explode();
      this.destroy();
      bricks = bricks.filter((b) => b !== this);
    }
  }

  update() {
    super.update();
    // Fade colour back to base
    if (this.hp > 0) {
      const t = this.hp / this.maxHp;
      this.color = this.baseColor.lerp(new LJS.Color(1, 1, 1), 1 - t + 0.15);
    }
  }

  explode() {
    const c = this.baseColor;
    new LJS.ParticleEmitter(
      this.pos, 0,              // pos, angle
      0.5,                      // emitSize
      0,                        // emitTime (burst)
      40,                       // emitRate
      Math.PI * 2,              // emitConeAngle
      undefined,                // tileInfo
      c, c.lerp(new LJS.Color(1, 1, 1), 0.5),   // colorStartA, colorStartB
      new LJS.Color(c.r, c.g, c.b, 0), new LJS.Color(c.r * 0.5, c.g * 0.5, c.b * 0.5, 0), // colorEndA/B
      0.5,  // particleTime
      0.12, // sizeStart
      0.0,  // sizeEnd
      0.18, // particleSpeed
      0.06, // particleAngleSpeed
      0,    // damping
      0,    // angleDamping
      0.1,  // gravityScale
      0.5,  // particleConeAngle
      0.1,  // fadeRate
      1,    // randomness
      false // collide
    );
  }
}

// ─── Ball class ───────────────────────────────────────────────────────────────
class Ball extends LJS.EngineObject {
  speed: number;

  constructor(pos: LJS.Vector2, vel: LJS.Vector2) {
    super(pos, LJS.vec2(BALL_R * 2));
    this.velocity = vel;
    this.speed = vel.length();
    this.color = new LJS.Color(1, 1, 1);
    this.gravityScale = 0;
    this.elasticity = 1;
    this.friction = 0;
  }

  update() {
    if (ballStuck && paddle) {
      // Glue to paddle
      this.pos = LJS.vec2(paddle.pos.x, PADDLE_Y + PADDLE_H * 0.5 + BALL_R + 0.05);
      this.velocity = LJS.vec2(0, 0);
      return;
    }

    // Normalise speed (prevent drift)
    const len = this.velocity.length();
    if (len > 0.001) {
      this.speed = LJS.clamp(this.speed, BALL_SPEED_INIT, BALL_SPEED_MAX);
      this.velocity = this.velocity.scale(this.speed / len);
    }

    // Wall bounces (left/right/top)
    const halfW = WORLD_W - BALL_R;
    if (this.pos.x < -halfW) { this.pos.x = -halfW; this.velocity.x = Math.abs(this.velocity.x); sndBounce.play(this.pos); }
    if (this.pos.x >  halfW) { this.pos.x =  halfW; this.velocity.x = -Math.abs(this.velocity.x); sndBounce.play(this.pos); }
    const halfH = WORLD_H - BALL_R;
    if (this.pos.y >  halfH) { this.pos.y =  halfH; this.velocity.y = -Math.abs(this.velocity.y); sndBounce.play(this.pos); }

    // Fell below paddle → lose a life
    if (this.pos.y < -WORLD_H - 1) {
      lives -= 1;
      sndLose.play();
      // Small screen-shake via camera
      LJS.setCameraPos(LJS.vec2((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4));
      if (lives <= 0) {
        if (score > highScore) {
          highScore = score;
          localStorage.setItem("brickblast_hs", String(highScore));
        }
        phase = "dead";
        this.destroy();
        ball = null;
      } else {
        // Reset ball to paddle
        ballStuck = true;
        this.pos = LJS.vec2(paddle ? paddle.pos.x : 0, PADDLE_Y + PADDLE_H * 0.5 + BALL_R + 0.05);
        this.velocity = LJS.vec2(0, 0);
      }
      return;
    }

    // Paddle collision
    if (paddle) {
      const dx = Math.abs(this.pos.x - paddle.pos.x);
      const dy = Math.abs(this.pos.y - paddle.pos.y);
      const overlapX = PADDLE_W * 0.5 + BALL_R - dx;
      const overlapY = PADDLE_H * 0.5 + BALL_R - dy;
      if (overlapX > 0 && overlapY > 0) {
        if (overlapY < overlapX) {
          // Hit top/bottom of paddle
          this.velocity.y = Math.abs(this.velocity.y); // always bounce up
          this.pos.y = paddle.pos.y + PADDLE_H * 0.5 + BALL_R;
          // Add angle based on where ball hit paddle
          const rel = (this.pos.x - paddle.pos.x) / (PADDLE_W * 0.5);
          this.velocity.x += rel * 0.08;
          sndBounce.play(this.pos);
          // Speed up slightly each paddle hit
          this.speed = Math.min(this.speed + 0.008, BALL_SPEED_MAX);
        } else {
          // Side of paddle
          this.velocity.x = this.pos.x > paddle.pos.x ? Math.abs(this.velocity.x) : -Math.abs(this.velocity.x);
          sndBounce.play(this.pos);
        }
      }
    }

    // Brick collisions
    for (const brick of [...bricks]) {
      const dx = Math.abs(this.pos.x - brick.pos.x);
      const dy = Math.abs(this.pos.y - brick.pos.y);
      const hw = (BRICK_W - BRICK_GAP) * 0.5 + BALL_R;
      const hh = (BRICK_H - BRICK_GAP) * 0.5 + BALL_R;
      if (dx < hw && dy < hh) {
        const overlapX = hw - dx;
        const overlapY = hh - dy;
        if (overlapX < overlapY) {
          this.velocity.x = this.pos.x > brick.pos.x ? Math.abs(this.velocity.x) : -Math.abs(this.velocity.x);
        } else {
          this.velocity.y = this.pos.y > brick.pos.y ? Math.abs(this.velocity.y) : -Math.abs(this.velocity.y);
        }
        const pts = brick.maxHp;
        score += pts * 10;
        sndBrick.play(brick.pos);
        brick.hit();
        break; // one brick per frame to avoid tunnelling weirdness
      }
    }

    // Restore camera drift
    LJS.setCameraPos(LJS.vec2(
      LJS.getCameraPos().x * 0.85,
      LJS.getCameraPos().y * 0.85,
    ));

    super.update();
  }

  render() {
    // Glowing ball: draw a slightly larger translucent circle beneath
    LJS.drawRect(this.pos, LJS.vec2(BALL_R * 3.2), new LJS.Color(1, 1, 1, 0.12));
    LJS.drawRect(this.pos, LJS.vec2(BALL_R * 2.2), new LJS.Color(1, 1, 1, 0.35));
    LJS.drawRect(this.pos, LJS.vec2(BALL_R * 2),   new LJS.Color(1, 1, 1));
  }
}

// ─── Build brick grid ─────────────────────────────────────────────────────────
function spawnBricks() {
  bricks.forEach((b) => b.destroy());
  bricks = [];
  const totalW = BRICK_COLS * BRICK_W;
  const startX = -totalW / 2 + BRICK_W / 2;
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      const x = startX + col * BRICK_W;
      const y = BRICK_TOP - row * BRICK_H;
      // Harder bricks near the top
      const hp = BRICK_ROWS - row;
      bricks.push(new Brick(LJS.vec2(x, y), row, hp));
    }
  }
}

// ─── Engine lifecycle ─────────────────────────────────────────────────────────
function gameInit() {
  LJS.setCameraPos(LJS.vec2(0, 0));
  LJS.setCameraScale(CAM_SCALE);

  paddle = new LJS.EngineObject(LJS.vec2(0, PADDLE_Y), LJS.vec2(PADDLE_W, PADDLE_H));
  paddle.color = new LJS.Color(0.35, 0.8, 1.0);
  paddle.gravityScale = 0;
  paddle.mass = 0;
}

function resetGame() {
  // Destroy old ball
  if (ball) { ball.destroy(); ball = null; }
  score = 0;
  lives = 3;
  ballStuck = true;
  spawnBricks();
  phase = "playing";
  sndStart.play();
}

function gameUpdate() {
  // ── Paddle movement (always active for feel) ──────────────────────────────
  if (paddle) {
    const dx = Number(LJS.keyIsDown("ArrowRight")) - Number(LJS.keyIsDown("ArrowLeft"));
    paddle.pos.x = LJS.clamp(paddle.pos.x + dx * PADDLE_SPEED, -WORLD_W + PADDLE_W * 0.5, WORLD_W - PADDLE_W * 0.5);
    // Mouse / touch follow
    if (LJS.mousePos.x !== 0 || LJS.mousePos.y !== 0) {
      paddle.pos.x = LJS.clamp(LJS.mousePos.x, -WORLD_W + PADDLE_W * 0.5, WORLD_W - PADDLE_W * 0.5);
    }
  }

  // ── Phase: start ──────────────────────────────────────────────────────────
  if (phase === "start") {
    if (LJS.mouseWasPressed(0) || LJS.keyWasPressed("Space") || LJS.keyWasPressed("Enter")) {
      resetGame();
    }
    return;
  }

  // ── Phase: dead / won ─────────────────────────────────────────────────────
  if (phase === "dead" || phase === "won") {
    if (LJS.mouseWasPressed(0) || LJS.keyWasPressed("Space") || LJS.keyWasPressed("Enter")) {
      resetGame();
    }
    return;
  }

  // ── Phase: playing ────────────────────────────────────────────────────────
  // Launch ball
  if (ballStuck) {
    if (!ball && paddle) {
      ball = new Ball(
        LJS.vec2(paddle.pos.x, PADDLE_Y + PADDLE_H * 0.5 + BALL_R + 0.05),
        LJS.vec2(0, 0),
      );
    }
    if (LJS.mouseWasPressed(0) || LJS.keyWasPressed("Space") || LJS.keyWasPressed("ArrowUp")) {
      ballStuck = false;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      if (ball) {
        ball.velocity = LJS.vec2(Math.cos(angle), Math.sin(angle)).scale(BALL_SPEED_INIT);
        ball.speed = BALL_SPEED_INIT;
      }
    }
  }

  // Check win
  if (bricks.length === 0 && phase === "playing") {
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("brickblast_hs", String(highScore));
    }
    phase = "won";
    sndWin.play();
    // Big particle celebration
    if (ball) {
      new LJS.ParticleEmitter(
        LJS.vec2(0, 0), 0, 8, 0.1, 200, Math.PI * 2,
        undefined,
        new LJS.Color(1, 0.9, 0.2), new LJS.Color(0.2, 1, 0.6),
        new LJS.Color(1, 0.5, 0.1, 0), new LJS.Color(0.2, 0.6, 1, 0),
        1.2, 0.2, 0.05, 0.25, 0.1, 0, 0, 0.05, 0.5, 0.1, 1, false,
      );
    }
  }
}

function gameRender() {
  // ── Background gradient strips ────────────────────────────────────────────
  LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(WORLD_W * 2, WORLD_H * 2), new LJS.Color(0.04, 0.04, 0.12));

  // Subtle horizontal scanlines for retro feel
  for (let y = -WORLD_H; y < WORLD_H; y += 1.2) {
    LJS.drawRect(LJS.vec2(0, y), LJS.vec2(WORLD_W * 2, 0.02), new LJS.Color(1, 1, 1, 0.02));
  }

  // ── Paddle glow ───────────────────────────────────────────────────────────
  if (paddle) {
    LJS.drawRect(paddle.pos, LJS.vec2(PADDLE_W + 0.3, PADDLE_H + 0.3), new LJS.Color(0.35, 0.8, 1.0, 0.18));
    LJS.drawRect(paddle.pos, LJS.vec2(PADDLE_W, PADDLE_H), new LJS.Color(0.35, 0.8, 1.0));
    // Highlight stripe
    LJS.drawRect(
      LJS.vec2(paddle.pos.x, paddle.pos.y + PADDLE_H * 0.25),
      LJS.vec2(PADDLE_W - 0.2, PADDLE_H * 0.25),
      new LJS.Color(1, 1, 1, 0.3),
    );
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  LJS.drawText(`${score}`, LJS.vec2(0, WORLD_H - 1.1), 1.4, new LJS.Color(1, 1, 1));
  // Lives as dots
  for (let i = 0; i < 3; i++) {
    const filled = i < lives;
    LJS.drawRect(
      LJS.vec2(-WORLD_W + 1.0 + i * 0.85, WORLD_H - 0.9),
      LJS.vec2(0.55),
      filled ? new LJS.Color(0.35, 0.8, 1.0) : new LJS.Color(0.3, 0.3, 0.4),
    );
  }
  LJS.drawText(`HI ${highScore}`, LJS.vec2(WORLD_W - 2.2, WORLD_H - 0.9), 0.75, new LJS.Color(0.5, 0.5, 0.7));

  // ── Overlays ──────────────────────────────────────────────────────────────
  if (phase === "start") {
    LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(WORLD_W * 2, WORLD_H * 2), new LJS.Color(0, 0, 0, 0.55));
    LJS.drawText("BRICK BLAST", LJS.vec2(0, 3.5), 2.2, new LJS.Color(0.35, 0.8, 1.0));
    LJS.drawText("Break all the bricks!", LJS.vec2(0, 1.5), 0.9, new LJS.Color(0.8, 0.8, 1.0));
    LJS.drawText("← → or mouse to move", LJS.vec2(0, 0.2), 0.75, new LJS.Color(0.6, 0.6, 0.8));
    LJS.drawText("SPACE / tap to launch", LJS.vec2(0, -0.7), 0.75, new LJS.Color(0.6, 0.6, 0.8));
    LJS.drawText("TAP TO START", LJS.vec2(0, -2.5), 1.1, new LJS.Color(1, 0.9, 0.2));
    if (highScore > 0) {
      LJS.drawText(`Best: ${highScore}`, LJS.vec2(0, -4.0), 0.85, new LJS.Color(0.5, 0.8, 0.5));
    }
  }

  if (phase === "dead") {
    LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(WORLD_W * 2, WORLD_H * 2), new LJS.Color(0, 0, 0, 0.6));
    LJS.drawText("GAME OVER", LJS.vec2(0, 2.5), 2.2, new LJS.Color(1, 0.3, 0.3));
    LJS.drawText(`Score: ${score}`, LJS.vec2(0, 0.8), 1.1, new LJS.Color(1, 1, 1));
    LJS.drawText(`Best:  ${highScore}`, LJS.vec2(0, -0.5), 1.0, new LJS.Color(0.5, 0.8, 0.5));
    LJS.drawText("TAP TO RETRY", LJS.vec2(0, -2.4), 1.1, new LJS.Color(1, 0.9, 0.2));
  }

  if (phase === "won") {
    LJS.drawRect(LJS.vec2(0, 0), LJS.vec2(WORLD_W * 2, WORLD_H * 2), new LJS.Color(0, 0, 0, 0.5));
    LJS.drawText("YOU WIN! 🎉", LJS.vec2(0, 2.5), 2.0, new LJS.Color(1, 0.9, 0.2));
    LJS.drawText(`Score: ${score}`, LJS.vec2(0, 0.8), 1.1, new LJS.Color(1, 1, 1));
    LJS.drawText(`Best:  ${highScore}`, LJS.vec2(0, -0.5), 1.0, new LJS.Color(0.5, 0.8, 0.5));
    LJS.drawText("TAP TO PLAY AGAIN", LJS.vec2(0, -2.4), 1.0, new LJS.Color(1, 0.9, 0.2));
  }

  if (phase === "playing" && ballStuck) {
    LJS.drawText("SPACE / tap to launch", LJS.vec2(0, -6.5), 0.75, new LJS.Color(0.7, 0.7, 0.9, 0.8));
  }
}

function gameRenderPost() {}
function gameUpdatePost() {}

// ─── React shell ──────────────────────────────────────────────────────────────
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || startedRef.current) return;
    startedRef.current = true;

    void LJS.engineInit(
      gameInit,
      gameUpdate,
      gameUpdatePost,
      gameRender,
      gameRenderPost,
      [],
      container,
    );
  }, []);

  return (
    <Shell>
      <div ref={containerRef} className="w-full h-full min-h-[400px]" />
    </Shell>
  );
}
