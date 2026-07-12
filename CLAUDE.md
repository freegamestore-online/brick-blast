# APPNAME

## Platform: FreeGameStore
- Hosted on Cloudflare R2 (static SPA, served by host Worker)
- ONE environment only (production). No dev/staging. Fix forward, no rollbacks.
- Push to `main` auto-deploys to production via R2
- Domain: APPNAME.freegamestore.online

## Tech Stack
- TypeScript, React 19, Vite 8, Tailwind CSS 4, pnpm
- LittleJS for rendering, particles, sound and input — all built in, zero assets
- No backend (standalone app) — all data in localStorage
- Must work offline (PWA)

## Engine: LittleJS
Tiny all-in-one arcade engine: renderer, particle system, procedural ZzFX
sound effects and input in one package — juicy games with NO asset files.
- Boot: `engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost, [], rootElement)` — once per page; keep the rootElement so the canvas stays in the Shell
- World space + camera: `setCameraPos(vec2(...))`, `setCameraScale(...)`
- Draw in gameRender: `drawRect(pos, size, color, angle)`, `drawText(...)`, `drawTile(...)`
- Game objects: `class Thing extends EngineObject { update() {...} render() {...} }` — built-in physics (velocity, gravityScale, collision)
- Input: `keyIsDown(...)`, `mousePos` (world space), `mouseWasPressed(0)`
- Sound with NO files: `new Sound([...zzfx params])` — procedural effects
- Particles: `new ParticleEmitter(...)` for explosions/trails, built in

## Brand Guidelines
- Fonts: Manrope (body) + Fraunces (display)
- Follow CSS variables in index.css for colors
- Dark mode via prefers-color-scheme (no toggle)

## Rules
- No analytics, no tracking, no cookies
- All user data in localStorage only
- MIT license
