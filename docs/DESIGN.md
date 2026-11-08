# Design notes: the warm redesign (8 Nov 2026)

What this file is for: text you can paste into Devpost about the interface, a 40-second overview demo, and a short record of the design rules, for anyone who reads the repo. The redesign was built overnight with AI assistance (Claude), like the rest of the project.

## Paste into Devpost

**Under "How we built it" (one bullet):**

- The interface is warm and calm: cream and sand surfaces, espresso-brown panels, the ALS Association's red for red flags, and ice blue as the only interactive colour (a nod to the Ice Bucket Challenge and to Lou Gehrig's blue and white). The overview scrolls like a product page:
  - a 3D point-cloud body whose hand, leg, voice or chest lights up as you tick red flags in a live calculator that runs the real engine and weights;
  - four "how it works" cards with objects drawn in scanlines;
  - Alex's 7 visits by 5 body regions;
  - an Ice Bucket Challenge section where the mouse ripples the water.

  Everything is drawn with plain Canvas 2D and no libraries, so it works offline. Animations pause off screen, become still frames for people who prefer reduced motion, and step down automatically on slow laptops.

**Under "Accomplishments" (optional):**

- Tiers never rely on colour alone (each has its word: High, Unclear, Low), every label and chip has at least 4.5:1 contrast, and every screen was checked at phone, tablet and six laptop sizes.

## Demo: the overview in about 40 seconds

`docs/PITCH.md` step 1 now uses this demo. Leave Home data off.

1. **Hero.** In the red-flag calculator, tick **Foot drop**. The right foot lights up on the body, and the range moves from 5.2–20% to 43–80%, still High. Press **Reset to Alex**.
2. **How it works.** Scroll: four cards slide sideways (Read, Weight, Range, Act). On card 3, switch the referral line and watch the line move against the range.
3. **The pattern.** Press **One clinician at a time**, then **All visits together**: the pattern only shows when the visits are read together.
4. **Follow one patient.** The tool's EMG prompt on 9 Dec 2024 against the real referral on 16 Feb 2026: 14.3 months earlier, at every referral line.
5. **Ice Bucket Challenge** (if there is time). Move the mouse over the water, click to drop an ice cube, and point at the sources under each figure.

## The design rules

**Colour**
- One accent: ice blue (`--accent`) marks everything you can press. Nothing else uses it.
- ALS red (`--flag`) marks red flags and the brand mark only.
- Tiers have their own colours: High is brick red, Unclear amber, Low sage. Each always comes with its word.
- "Real", "Simulated" and "Assumption" chips form one neutral family, told apart by their border (solid, dashed, dotted). They never look like a button or a tier.
- All of these are tokens in `app/css/app.css`, so changing the palette is a one-file edit.

**Imagery**
- Abstract body and nerve-signal scenes, never a figure that falls apart. People with ALS are shown as active, not as objects of pity.
- The Ice Bucket figures are sourced on the page. The link from the challenge money to the NEK1 gene finding is labelled partly indirect.

**Motion and accessibility**
- Animations run only while on screen.
- With reduced motion turned on, every scene is one still frame and moving the mouse redraws nothing.
- On a slow laptop (frames slower than 22 ms for over a second), scenes step down: sharpness first, then frame rate, then a still frame.
- The hero headline cycles its last words twice, then settles. It pauses while the pointer or keyboard focus is on the hero text or the calculator (WCAG 2.2.2).
- Canvases are hidden from screen readers; the numbers they show are also in the text.
- There is a "Skip to content" link, and focus moves to the new screen when you switch views.
- Range ends that would print the same as the referral line get enough decimals to show their side ("5.2% to 20.05%" at the 20% line), so the words always agree with the tier.

**Layout**
- The overview is a scrolling story; the other screens stay a working app (sidebar, one-row top bar, cards).
- Checked sizes:
  - phone: 390px wide
  - tablet: 768px
  - laptops: 1024×728 (the size claude.ai's viewer can give the app), 1200×800, 1280×720, 1366×768, 1440×1000 and 1920×1080, plus the overview and the top bar at 1366×650 (a 1366 screen once the browser's bars are taken off)
- No screen scrolls sideways at any of these sizes, and the top bar stays one row from 1181px up.

**How the effects are built**
- `app/js/fx/core.js` is a small shared runtime:
  - canvas sizing for sharp screens
  - an on-screen check
  - an eased pointer
  - the reduced-motion still frame
  - the slow-laptop guard
- Each scene has its own file: `pointcloud.js` (the hero body), `scanline.js` (the step objects), `ripples.js` (the water) and `scramble.js` (the headline).

## Status of the other docs

Done by the main session at about 05:30: `docs/DEVPOST.md` has the interface bullet and the accessibility bullet, `docs/PITCH.md` demo step 1 now uses the overview demo above, and both use the current test count.
