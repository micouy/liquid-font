# Pipeline

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                      GPU (WebGL)                         │
│                                                          │
│  ┌──────────────┐    ping-pong     ┌──────────────┐     │
│  │ State Tex A  │◄──────────────►  │ State Tex B   │     │
│  │ (RGBA32F)    │                  │ (RGBA32F)     │     │
│  │ R=x G=y     │                  │ R=x G=y      │     │
│  │ B=vx A=vy   │                  │ B=vx A=vy    │     │
│  └──────┬───────┘                  └──────┬───────┘     │
│         │                                  │             │
│         └──────────┐  ┌───────────────────┘             │
│                    ▼  ▼                                 │
│         ┌─────────────────────┐                        │
│         │  Simulation Shader  │                        │
│         │  (fragment shader)   │                        │
│         │                     │                        │
│         │  Per particle:       │                        │
│         │  - Read own state    │                        │
│         │  - Iterate ALL other │                        │
│         │    particles         │                        │
│         │  - Compute forces:   │                        │
│         │    • Repulsion       │                        │
│         │    • Cohesion        │                        │
│         │    • Surface tension │                        │
│         │    • Gravity         │                        │
│         │  - Integrate (Euler) │                        │
│         │  - Wall collisions   │                        │
│         │  - Write new state   │                        │
│         └─────────────────────┘                        │
│                                                          │
└──────────────────────────┬──────────────────────────────┘
                           │
                    gl.readPixels()
                    (download positions)
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      CPU (JavaScript)                    │
│                                                          │
│  ┌────────────────────────┐                              │
│  │  Debug force compute   │  (O(n²) on CPU, for graph   │
│  │  (main.ts computeForces)│   only - NOT used for sim) │
│  └────────────────────────┘                              │
│                                                          │
│  ┌────────────────────────┐                              │
│  │  2D Canvas rendering   │  Draw circles at particle    │
│  │  (main.ts render)      │  positions, debug graphs    │
│  └────────────────────────┘                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Per Frame

1. **GPU**: Simulation shader reads state texture, computes all forces + integration, writes new state to alternate texture
2. **CPU → GPU**: `gl.readPixels()` downloads RGBA float positions from current read texture
3. **CPU**: `computeForces()` recalculates forces on CPU from downloaded positions (debug only, not affecting simulation)
4. **CPU**: Draw each particle as a circle on 2D canvas, draw debug timeline graphs

## What runs where

| Computation | Where | Why |
|---|---|---|
| Gravity | GPU | Force applied per particle |
| Repulsion (< repDist) | GPU | Pairwise, $1/r^2$ |
| Cohesion (> repDist, < smoothR) | GPU | Pairwise, $1/r$ |
| Surface tension (neighbor deficit) | GPU | Per particle, based on neighbor count and normal |
| Wall bouncing | GPU | Per particle boundary check |
| Air friction | GPU | Per particle velocity damping |
| Euler integration | GPU | Position/velocity update |
| Debug force graph | CPU | Recomputed from readPixels for visualization |
| Particle rendering | CPU | 2D canvas arc() calls |