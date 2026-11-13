# Orbit Lab

Unitless orbit simulation for the "find G by linearizing T(R)" lab. One star (M = 500), one planet (m = 0.001), real Newtonian gravity. The whole page is the space field; every control is inside it. Static site on Firebase Hosting, no server.

## The lab flow

1. Drag the planet to a spot. Drag the blue velocity handle (or out from the planet) to give it a velocity. The arrow is measured against circular-orbit speed: about 90 px sideways is a circle, shorter is an ellipse that dips closer to the star, longer is a bigger ellipse. It can't be pulled past 1.2x circular speed, so a release always makes an orbit and never flies off forever. With **no** velocity it falls straight into the star and crashes.
2. Press **Play** (or Space). The **timer** (3 decimals) counts simulated seconds; the **Simulation Speed** slider (0.5x to 5x) slows it down or speeds it up. At 1.0x the timer is the wall clock, and at any other speed it still reads true simulated seconds, so a period measured at any speed is the same number.
3. Pause when the planet has completed a lap and read T off the timer.
4. The path it traced stays on screen while paused; **Reset** (or moving the planet) clears it. The **Tape measure** button shows a separate tool with a handle at each end; drag the handles (or the line, to move the whole thing) to measure the major axis. It doesn't snap to anything; zoom for precision. r = half of the major axis. If the planet crashes into the star, a big picture (`public/img/crash.png`) flashes faintly behind the sim for a tenth of a second, and an explosion marks the collision point until Reset.
5. **Reset** (or move the planet) and repeat at other sizes. Plot T² vs r³; the slope is `4π² / (500 G)`.
6. Students report their **Set** letter (shown in the top-right corner); the instructor looks up the actual G in the key below to compare it to their graph's slope.

The **Timer** panel can be dragged by its header, resized from its bottom-right corner, and put back in its corner with the reset button that appears (or by double-clicking the header).

## 3D view

The **3D view** button swaps the flat field for a three.js scene and the whole lab works in it: drag the planet along the orbital plane, drag out the velocity arrow, use the tape measure, Play / Reset / speed, zoom buttons. It opens as a bird's-eye view straight down on the orbit (same orientation as 2D); drag empty space to tilt and orbit the camera, right-drag (or shift-drag) to pan it, scroll to zoom toward the cursor, and the reset-view button returns to the bird's-eye. The camera only moves when you move it.

The scene: a boiling sun with a soft corona, a turquoise-and-green planet with clouds and a glowing atmosphere (lit from the sun's real position), drifting dust in a nebula sky, bloom and a light film grade. Bodies are drawn bigger than their physical size so they stay visible. If the planet hits the sun it is destroyed on the surface: a flash, an expanding shockwave, a spray of debris and a short camera jolt. three.js is vendored in `public/js/vendor/three/`, so it works offline.

## Launch velocity

The arrow scales with the zoom in both views (it is a fixed length in the simulation's own units, 90 px at the default zoom for a circular orbit). While you are placing the planet, the launch speed is printed on it (`v = 344.3`, or `v = 0.0` under the planet before any arrow is pulled), in both views. Note that for a circular orbit `v = sqrt(G M / r)`, so students can back out G from a circular launch if they measure r with the tape.

## Instructor key

| Set | G |
| --- | --- |
| A | 22000 |
| B | 24000 |
| C | 25500 |
| D | 27500 |
| E | 30000 |
| F | 32500 |
| G | 35000 |
| H | 37500 |
| I | 40500 |
| J | 44000 |
| K | 47500 |
| L | 51000 |
| M | 55500 |
| N | 59500 |
| O | 64500 |
| P | 69500 |
| Q | 75000 |
| R | 81000 |
| S | 87500 |
| T | 94500 |
| U | 102000 |
| V | 110500 |
| W | 119000 |
| X | 128500 |
| Y | 139000 |
| Z | 150000 |

The values live in `public/js/constant.js` (`G_KEY`). There is no PIN, `.env` or build step.

## How the letter works

- On first load each browser draws a random letter A-Z; each letter is a fixed G (none within 10% of 10000).
- It is kept in `localStorage` **encrypted** (AES-GCM, with a non-extractable key held in IndexedDB), so a reload gives the same letter. Clearing site data or using a private window draws a new one.
- Honest limit: there is no server and the key ships in the page's JavaScript, so a determined student could read it with devtools.

## Physics

Two-body Newtonian gravity, leapfrog integration with a step proportional to the local dynamical time `sqrt(r³/GM)`, so close passes of eccentric orbits stay accurate. `npm test` checks that:

- a planet with no velocity crashes in the free-fall time,
- orbit periods match `T = 2π sqrt(a³/GM)` (a = semi-major axis) for circular and elliptical orbits across the whole range of G and r.

## Test it

```bash
npm test        # letter key, physics checks
npm run dev     # http://localhost:5000
```

Open a private window to act as a second student with a different letter.

## Deploy

```bash
npx firebase-tools login
npx firebase-tools use --add   # pick (or create) a Firebase project
npm run deploy                 # publishes public/
```

Free Spark plan is enough.
