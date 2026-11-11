# Orbit Lab

Unitless orbit simulation for the "find G by linearizing T(R)" lab. One star (M = 500), one planet (m = 0.001), real Newtonian gravity. The whole page is the space field; every control is inside it. Static site on Firebase Hosting, no server.

## The lab flow

1. Drag the planet to a spot. Drag the blue velocity handle (or out from the planet) to give it a velocity. With **no** velocity it falls straight into the star and crashes; too fast and it escapes.
2. Press **Play** (or Space). The **timer** (3 decimals) counts simulated seconds; the **Simulation Speed** slider (0.5x to 5x) slows it down or speeds it up. At 1.0x the timer is the wall clock, and at any other speed it still reads true simulated seconds, so a period measured at any speed is the same number.
3. Pause when the planet has completed a lap and read T off the timer.
4. The path it traced stays on screen while paused; **Reset** (or moving the planet) clears it. The **Tape measure** button shows a separate tool with a handle at each end; drag the handles (or the line, to move the whole thing) to measure the major axis. It doesn't snap to anything; zoom for precision. r = half of the major axis. If the planet crashes into the star, a big picture (`public/img/crash.png`) flashes faintly behind the sim for a tenth of a second, and an explosion marks the collision point until Reset.
5. **Reset** (or move the planet) and repeat at other sizes. Plot T² vs r³; the slope is `4π² / (500 G)`.
6. The instructor reveals the actual G afterwards (below) so students can compare it to their graph's slope.

## Instructor

The **Instructor** button asks for the PIN, which opens the instructor panel. The PIN box is a plain text field drawn as dots (not a browser password field), so browsers and password managers never offer to save it; the eye button shows or hides what you typed:

- **Show / Hide** for this computer's G (hidden every time the panel is opened),
- a switch for the **theoretical orbit radius** (semi-major axis, half the major axis) and one for the **theoretical orbit time**; both appear on the sim and update live as the planet is moved or re-aimed (they read "—" if the setup isn't a closed orbit, e.g. no velocity or too fast),
- **Randomize G** (two clicks, restarts the simulation).

Closing the panel locks it again; the two switches stay as you left them.

The PIN comes from the `TEACHER_PIN` environment variable (or the git-ignored `.env`). `scripts/build-config.js` turns it into a salted PBKDF2 hash in `public/js/config.js` before every dev run, test and deploy; the PIN itself is never in the site.

## How G works

- On first load each browser draws a random G, log-uniform between **8000 and 100000** (values within 10% of 10000 are skipped), rounded to 3 significant figures.
- It is kept in `localStorage` **encrypted** (AES-GCM, with a non-extractable key held in IndexedDB), so a reload gives the same G and nothing readable sits in storage. Clearing site data or using a private window gives a new G.
- Honest limit: there is no server, so everything runs in the student's browser. A determined student could dig G out with devtools or brute-force the PIN hash offline.

## Physics

Two-body Newtonian gravity, leapfrog integration with a step proportional to the local dynamical time `sqrt(r³/GM)`, so close passes of eccentric orbits stay accurate. `npm test` checks that:

- the PIN check works and only the hash is shipped,
- a planet with no velocity crashes in the free-fall time,
- orbit periods match `T = 2π sqrt(a³/GM)` (a = semi-major axis) for circular and elliptical orbits across the whole range of G and r.

## Test it

```bash
npm test        # G range/variety, PIN hash, physics checks
npm run dev     # http://localhost:5000
```

Open a private window to act as a second student with a different G.

## Deploy

```bash
cp .env.example .env           # set TEACHER_PIN
npx firebase-tools login
npx firebase-tools use --add   # pick (or create) a Firebase project
npm run deploy                 # hashes the PIN, then publishes public/
```

You can also set the PIN without a file: `TEACHER_PIN=... npm run deploy` (PowerShell: `$env:TEACHER_PIN="..."; npm run deploy`). Free Spark plan is enough.
