import { useEffect, useRef } from "react";
import * as LJS from "littlejsengine";
import { Shell } from "./components/Shell";

// A complete, playable reference game on LittleJS. It shows every pattern you
// need: engineInit into a container, an EngineObject with physics, keyboard +
// mouse input (Number()-wrapped for arithmetic), procedural sound with NO
// asset files, a particle burst, a HUD via drawText, and game-over + restart.
// Replace the game rules; keep the patterns.

// Procedural sound effects — zero asset files (ZzFX parameter arrays).
const catchSound = new LJS.Sound([, , 400, , 0.1, 0.2, , 1.5, , , 200, 0.05]);
const missSound = new LJS.Sound([, , 120, , 0.2, 0.3, 1, 0.5, , , , , , 0.3]);

// A falling orb the player catches. EngineObject carries pos/velocity/physics.
class Orb extends LJS.EngineObject {
  constructor(pos: LJS.Vector2) {
    super(pos, LJS.vec2(0.8));
    this.velocity = LJS.vec2(0, -0.08 - Math.random() * 0.06);
    this.color = new LJS.Color(0.2, 0.8, 0.6);
    this.gravityScale = 0;
  }
}

let paddle: LJS.EngineObject;
let orbs: Orb[] = [];
let score = 0;
let lives = 3;
let best = Number(localStorage.getItem("best") || "0");
let over = false;
let spawnT = 0;

function reset() {
  orbs.forEach((o) => o.destroy());
  orbs = [];
  score = 0;
  lives = 3;
  over = false;
  spawnT = 0;
}

function gameInit() {
  LJS.setCameraPos(LJS.vec2(0, 0));
  LJS.setCameraScale(32);
  paddle = new LJS.EngineObject(LJS.vec2(0, -6), LJS.vec2(3, 0.6));
  paddle.color = new LJS.Color(0.2, 0.9, 0.5);
  paddle.gravityScale = 0;
}

function gameUpdate() {
  if (over) {
    if (LJS.mouseWasPressed(0) || LJS.keyWasPressed("Space")) reset();
    return;
  }
  // Movement idiom: keyIsDown returns boolean — Number()-wrap for arithmetic.
  const dx = Number(LJS.keyIsDown("ArrowRight")) - Number(LJS.keyIsDown("ArrowLeft"));
  paddle.pos.x = LJS.clamp(paddle.pos.x + dx * 0.3, -8, 8);
  if (LJS.mousePos.x) paddle.pos.x = LJS.clamp(LJS.mousePos.x, -8, 8);

  spawnT += 1;
  if (spawnT > 60) {
    spawnT = 0;
    orbs.push(new Orb(LJS.vec2((Math.random() - 0.5) * 16, 10)));
  }

  for (const orb of [...orbs]) {
    // Caught by the paddle?
    if (Math.abs(orb.pos.x - paddle.pos.x) < 2 && Math.abs(orb.pos.y - paddle.pos.y) < 1) {
      score += 1;
      catchSound.play(orb.pos);
      // Particle burst — juice for free, no assets.
      new LJS.ParticleEmitter(
        orb.pos, 0, 0.6, 0.1, 30, Math.PI,
        undefined, new LJS.Color(0.3, 1, 0.6), new LJS.Color(0.1, 0.6, 0.4),
        new LJS.Color(0.3, 1, 0.6, 0), new LJS.Color(0.1, 0.6, 0.4, 0),
        0.4, 0.1, 0.2, 0.1, 0.05,
      );
      orb.destroy();
      orbs = orbs.filter((o) => o !== orb);
    } else if (orb.pos.y < -10) {
      // Missed.
      lives -= 1;
      missSound.play();
      orb.destroy();
      orbs = orbs.filter((o) => o !== orb);
      if (lives <= 0) {
        over = true;
        best = Math.max(best, score);
        localStorage.setItem("best", String(best));
      }
    }
  }
}

function gameRender() {
  // HUD via drawText — screen-space text.
  LJS.drawText(`Score ${score}`, LJS.vec2(-8, 9), 1.2, new LJS.Color(1, 1, 1));
  LJS.drawText(`Lives ${lives}`, LJS.vec2(6, 9), 1.2, new LJS.Color(1, 0.6, 0.6));
  if (over) {
    LJS.drawText("Game Over", LJS.vec2(0, 1), 2.5, new LJS.Color(1, 1, 1));
    LJS.drawText(`Best ${best} — tap to retry`, LJS.vec2(0, -1.5), 1, new LJS.Color(0.7, 0.9, 1));
  }
}

function gameRenderPost() {}
function gameUpdatePost() {}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || startedRef.current) return;
    startedRef.current = true;
    void LJS.engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost, [], container);
  }, []);

  return (
    <Shell>
      <div ref={containerRef} className="w-full h-full min-h-[400px]" />
    </Shell>
  );
}
