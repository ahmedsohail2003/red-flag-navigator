# Hack the North 2026 AirPods-as-Wii-remote project: technical teardown

Research date 2026-11-07. Two Hack the North 2026 projects match: **Aircade** (the main match, an OpenAI API prize winner) and **Poddle** (a smaller AirPod pickleball game). Neither uses the Dolphin emulator, DSU/cemuhook or a virtual gamepad. Both read the AirPods' head-tracking IMU with Apple's `CMHeadphoneMotionManager` on a **Mac** and have the player **hold one earbud in the hand** like a Wii Remote. Nobody moves their head.

Source versions used:
- Aircade code: commit `0b165b4272e969b42e5380790783409e1adc6328` (2026-09-24), still the live `main` HEAD on 2026-11-07. Line links use the short SHA `0b165b4`.
- Poddle code: commit `7b0b37ada91f7d079e60a8e16ef844d42831877c` (2026-09-20 06:17 UTC, the last commit of the hacking night). The repo has kept growing since then into the website poddleball.com.
- Devpost pages: fetched 2026-11-07.

## What is the project called, and where are its Devpost page and GitHub repository?

### Takeaway
The project is **Aircade**, by Adyan Ullah, Yegor Zaytsev and Farhad Sadig. It was submitted to Hack the North 2026 and is marked "Winner OpenAI: API Prizes". Its Devpost page is https://devpost.com/software/aircade-m4n6zv, the code is at https://github.com/apollo-ullah/Aircade, and the demo video is https://www.youtube.com/watch?v=xdL29Ifvi_A. A second Hack the North 2026 entry, **Poddle** (Daniel Tan, Harry Y. and Felix Jeong as listed on Devpost), also turned a hand-held AirPod into a Wii-Sports-style paddle. Its Devpost page is https://devpost.com/software/wip-zdq95m and its code is at https://github.com/danielrltan/poddle. A third entry, Goose Gone Loose, did the same with an iPhone instead of AirPods.

### Cited Findings
- **Aircade on Devpost.**
  - Tagline: "we hacked the apple airpods SDK to build a wii remote that fits in the palm of your hands and lets you play against state of the art AI models."
  - Submitted to Hack the North 2026 and marked "Winner OpenAI: API Prizes".
  - Team: Adyan Ullah, Yegor Zaytsev, Farhad Sadig.
  - Built-with tags: baseten, codex, core-motion, gpt-6-astra, openai, solana, swift, vercel, vision.
  - The page links the GitHub repo apollo-ullah/Aircade and embeds YouTube video xdL29Ifvi_A.
  - Source: [Devpost: Aircade](https://devpost.com/software/aircade-m4n6zv), fetched 2026-11-07.
- **Aircade's Devpost write-up has no section titled "How we built it".** Its sections are "How it works", "Astra, the AI opponent", "Then we let Codex play", "Building it with Codex", "A small AI experiment" and "Why we built it". "How it works" plays the role of "How we built it" and says: "The arcade is built natively with Swift, SwiftUI, SceneKit, and Core Motion." — [Devpost: Aircade, "How it works"](https://devpost.com/software/aircade-m4n6zv)
- **Aircade repo.**
  - Description: "Aircade is a motion-controlled arcade for Mac, powered by the sensors in your AirPods. Play against state of the art AI models like TypeSafe's JEV or GPT-6 Astra."
  - Created 2026-09-19 09:19 UTC, during the event. Last push 2026-09-24. 2 stars.
  - Contributors: apollo-ullah (83 commits), yegorza (9), farhad-sadig1 (1).
  - Languages: mostly Swift (about 828 KB), plus JavaScript, HTML, Python, TypeScript and Shell.
  - Source: [GitHub: apollo-ullah/Aircade](https://github.com/apollo-ullah/Aircade), via the GitHub API on 2026-11-07.
- The README says: "We turned an AirPod into a Wii-style motion controller... Built at **Hack the North 2026** with Swift, SwiftUI, SceneKit, Core Motion, the OpenAI Responses API, and Codex." It links the demo, the Devpost page and the iPhone companion app. — [README.md L5-L11](https://github.com/apollo-ullah/Aircade/blob/0b165b4/README.md#L5-L11)
- The demo video is "Aircade Demo" on the channel "Yegor Zay" (@yegorzay). It was uploaded 2026-09-19 21:46 PDT, is 54 seconds long, had 172 views and has no description. — [YouTube: Aircade Demo](https://www.youtube.com/watch?v=xdL29Ifvi_A), via oEmbed and the page metadata on 2026-11-07
- **Poddle on Devpost.**
  - Tagline: "A laptop Pickleball experience with AirPod motion tracking!"
  - Submitted to Hack the North 2026 by Harry Y, Daniel Tan and Felix Jeong. No winner badge.
  - Built-with tag: "python" only. **Its "How we built it" section is empty.** No repo link.
  - What the page does say: "Players connect their AirPods to a computer, hold one in their hand, and swing as if they were holding a real paddle."
  - Source: [Devpost: Poddle](https://devpost.com/software/wip-zdq95m), fetched 2026-11-07.
- **Poddle repo.** danielrltan/poddle ("Wii-Sports-style pickleball where the controller is an AirPod!") was created 2026-09-20 04:28 UTC. Its first commit is "Poddle: AirPod-as-paddle pickleball for Hack the North 2026". — [GitHub: danielrltan/poddle](https://github.com/danielrltan/poddle); [README at 7b0b37a, L1-L7](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md)
- **Goose Gone Loose** (Hack the North 2026; Melody Wang, Elin Zhang, ditripy Robel, Jennifer Chen): "The iPhone has a built-in accelerometer... the iPhone can be used as a device for gaming input, similar to the Wii remote." Built with Godot. — [Devpost: Goose Gone Loose](https://devpost.com/software/goose-gone-loose)
- **Name collision.** A different "Aircade" (aj0khi/aircade-mru-hacks) is a hackathon project that uses AirPods as a motion controller for classic games such as Pong and Breakout. It is not a Hack the North entry. — [GitHub: aj0khi/aircade-mru-hacks](https://github.com/aj0khi/aircade-mru-hacks) (seen only in search results, not inspected)
- **The event.** Hack the North 2026 ran Sep 18–20, 2026 at the University of Waterloo (E5/PSE). It was invite-only, with 1030 participants and 39 non-cash prizes. "OpenAI: API Prizes" had 3 winners: "Use the OpenAI API to build something ambitious, with Codex as your development teammate". Judging covered what was built with the OpenAI API and how Codex helped build it. — [Hack the North 2026 Devpost](https://hackthenorth2026.devpost.com/), fetched 2026-11-07
- **Gallery scan.** I scanned all 15 pages of the Hack the North 2026 project gallery: 346 unique projects, 72 marked as winners. I searched names and taglines for airpod, earbud, headphone, Wii, motion, gyro, accelerometer, IMU, tilt, swing, controller, Dolphin and watch. Only **Aircade** (marked Winner) and **Poddle** use AirPods as a controller.
  - Other motion-controller entries: Goose Gone Loose (iPhone accelerometer), Bearlympics (phones as "Wii-style remotes"), aiClicker (iPhone as a controller for a Mac), Gestura (ESP32-S3 IMU gloves, winner of "Aramco Americas: Best Beginner Hack") and RePlay (wearable sensors).
  - Source: [Hack the North 2026 project gallery](https://hackthenorth2026.devpost.com/project-gallery), fetched 2026-11-07 with curl
- **Bearlympics:** "everyone else scans a QR code and their phone becomes a motion controller... DeviceOrientation for aim, DeviceMotion for gestures — swing, shake, jab". Gestures are found by "projecting acceleration onto the gravity vector rather than a fixed axis". Built with Next.js, three.js and Socket.IO. — [Devpost: Bearlympics](https://devpost.com/software/bckyrd)
- **aiClicker:** "a Mac app and an iPhone app that speak the same controller format... pair an iPhone with a QR code over the local network. The phone... sends your touches, gestures, and motion back to the Mac." — [Devpost: aiClicker](https://devpost.com/software/universal-controller)
- **Gestura:** "two wearable controllers using ESP32-S3 microcontrollers, IMUs, and touch sensors mounted onto gloves" that turn motion into keyboard and mouse commands. — [Devpost: Gestura](https://devpost.com/software/gestura-6m3xfv)

### Inferences
- Aircade is the project the request describes: the "Wii remote" wording, an arcade of motion games and a Hack the North 2026 prize. Poddle is a close second match, a single Wii-Sports-style game.
- The tagline's "hacked the apple airpods SDK" is marketing. The code uses only Apple's public `CMHeadphoneMotionManager` API (see the next section). The repo's own notes say the app "does not claim to force macOS to stream a particular earbud" ([VERIFICATION.md L75](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L75)).
- The commit counts suggest Adyan Ullah wrote most of Aircade's code. The team also credits Codex with much of the implementation and testing ([Devpost, "Building it with Codex"](https://devpost.com/software/aircade-m4n6zv)).

### Gaps
- **No social posts found.**
  - I found no LinkedIn, X, TikTok, Instagram or Reddit (r/uwaterloo) posts by either team. Web searches for "Aircade", the team names, "Poddle Hack the North" and "Hack the North AirPod Wii" returned nothing relevant, and I did not search those platforms directly.
  - A Product Hunt listing for Poddle quotes a "Daniel" saying it began as a last-minute hackathon idea. The search tool only summarised it, and I did not open it ([Product Hunt: Poddle](https://producthunt.com/products/poddle-3)).
- **Prize detail.** The Aircade page shows only "Winner OpenAI: API Prizes". The gallery does not say which of the three placings Aircade got.
- **Unchecked news item.** WatchGeneration (Nov 5, 2026) reports that an AirPods case can steer a Mac cursor "like the Wiimote". I did not check it, and nothing ties it to Hack the North ([WatchGeneration](https://www.watchgeneration.fr/audio/2026/11/un-boitier-dairpods-peut-controler-le-curseur-de-votre-mac-comme-la-wiimote-20499)).

## What does the source code show: the motion API, sample rate, data format and network transport?

### Takeaway
**Aircade:**
- The AirPods connect straight to a Mac over Bluetooth. A native macOS app reads them with `CMHeadphoneMotionManager`, taking the attitude quaternion, rotation rate, user acceleration, which earbud is sending, and the sensor timestamp.
- The team's logs put the delivered rate at about 33 to 50 Hz. Their 18-second recorded capture averaged 30.7 samples per second, with timestamps on a 20 ms grid.
- No network carries the AirPod data. Only the optional iPhone controller uses one: Bonjour plus TCP, sending length-prefixed JSON that the Mac requests one sample at a time.

**Poddle (at the hackathon):**
- A Swift command-line reader also used `CMHeadphoneMotionManager` and printed one JSON object per line.
- A Node.js bridge relayed those lines over a WebSocket on `localhost:8787` to a browser game.

### Cited Findings
**Aircade, AirPods path (Mac):**
- `MotionModel` imports AppKit and CoreMotion and adopts `CMHeadphoneMotionManagerDelegate`. — [MotionModel.swift L1-L2, L23](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L23)
- Starting the stream: it creates `CMHeadphoneMotionManager()`, calls `startConnectionStatusUpdates()` and `startDeviceMotionUpdates(to: motionQueue)`. — [MotionModel.swift L254-L261](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L254-L261)
- Per sample it reads `attitude.quaternion`, yaw/pitch/roll, `rotationRate`, `userAcceleration`, `timestamp` and `sensorLocation` (`.headphoneLeft` or `.headphoneRight`). — [MotionModel.swift L266-L280](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L266-L280)
- **Threading and rate:**
  - Callbacks go to a dedicated serial `OperationQueue` (QoS `.userInteractive`, one operation at a time). — [L114-L120](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L114-L120)
  - They land in a lock-protected `LatestInputBuffer`, which "coalesces sensor input so a busy UI consumes the newest reading, never a backlog". — [LatestInputBuffer.swift L3-L5](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/LatestInputBuffer.swift#L3-L5)
  - A main-run-loop timer drains that buffer every 1/60 s. — [MotionModel.swift L184-L186](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L184-L186)
  - The code never sets an update interval for the headphone stream.
- **Rate figures:**
  - The team logged "approximately **50 Hz**" (left AirPod) — [VERIFICATION.md L25](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L25)
  - Later, "approximately **33.5 Hz** consumed... fresh sample age **33 ms**" (right AirPod) — [L64](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L64)
  - And "approximately 32.7 Hz with an 11 ms receipt age" — [L97](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L97)
- **My measurement of the team's recorded capture.** The file is `docs/evidence/RecordedSensorCapture.json`: an 18-second recording of a resting left AirPod, made 2026-09-20 09:48 UTC.
  - 552 samples, or 30.7 samples per second.
  - Gaps between sensor timestamps were 20 ms (255 times), 40 ms (250), 60 ms (40), 80 ms (5) and 100 ms (1).
  - The app's own frequency readout had a median of 30.5 Hz.
  - Delay from sensor timestamp to app receipt: minimum 8.5 ms, median 23.9 ms, 90th percentile 35.5 ms, maximum 55.6 ms.
  - Source: [docs/evidence/RecordedSensorCapture.json](https://github.com/apollo-ullah/Aircade/blob/0b165b4/docs/evidence/RecordedSensorCapture.json)
- **Log format.** Each session writes a CSV with timestamp, source, condition label, quaternion, Euler angles, rotation rate (rad/s), user acceleration (g) and events. — [DEVELOPMENT.md "Logs and evidence" L144-L152](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L144-L152); [MotionModel.swift L529-L533](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L529-L533)
- **Requirements:** "macOS 14+, Xcode / Swift 5.9+, compatible AirPods". The package targets `.macOS(.v14), .iOS(.v16)`. — [README.md L105](https://github.com/apollo-ullah/Aircade/blob/0b165b4/README.md#L105); [Package.swift L6](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Package.swift#L6)
- **Out-of-ear streaming.** Users must "Turn off **Automatic Ear Detection**, hold the earbud in your calibrated grip, and click **Start AirPods**". The hardware-test guide calls out-of-ear streaming "an experiment, not a guarantee". — [DEVELOPMENT.md L64](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L64); [DEVELOPMENT.md L127](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L127)

**Aircade, iPhone path:**
- The phone app uses `CMMotionManager` with `deviceMotionUpdateInterval = 1.0 / 60` and reference frame `.xArbitraryZVertical`, and keeps only the attitude quaternion. — [PhoneController.swift L50-L57](https://github.com/apollo-ullah/Aircade/blob/0b165b4/iOS/AircadeController/PhoneController.swift#L50-L57)
- **Transport** (`ControllerLink`):
  - Bonjour service type `_aircade._tcp`, using Network.framework.
  - TCP with `noDelay = true` and `includePeerToPeer = true`, no TLS.
  - Each message is a Codable enum (`hello`, `welcome`, `poll`, `sample`, `feedback`, `recenter` and others) encoded with `JSONEncoder` behind a 4-byte big-endian length prefix, up to 8192 bytes.
  - The doc comment explains the design: "The phone only sends a sample in response to a poll, so there is never an unbounded queue of 60 Hz motion packets."
  - Source: [ControllerLink.swift L27-L88](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/ControllerLink/ControllerLink.swift#L27-L88)
- **Mac side of the phone link.**
  - The Mac advertises an `NWListener` service named "Aircade · <Mac name>".
  - A six-digit pairing code is checked in `hello`.
  - `tick()` sends a new poll as soon as the previous answer arrives. `ControllerSession` calls `tick()` from a 1/60 s timer.
  - Samples with a round trip of 250 ms or more are discarded, and the measured round trip is shown as `latency`.
  - Source: [PhoneControllerHost.swift L9, L32-L34, L82-L93, L113-L135](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/PhoneControllerHost.swift#L82-L135); [ControllerSession.swift L72-L75](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/ControllerSession.swift#L72-L75)
- **Frame payload.** A `PlayerControllerFrame` carries version, controllerID, sessionID, sequence, source, orientation quaternion (`SIMD4<Float>`), ready, simulated, and sampleAge ("Age at the sender, not its absolute uptime (peers have different clocks)"). — [PlayerControllers.swift L11-L35](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/PlayerControllers.swift#L11-L35)
- The iOS guide says: "Pairing and motion traffic use local TCP/Bonjour, with a lobby code and one phone slot. There is no cloud service." — [iOS/README.md L34](https://github.com/apollo-ullah/Aircade/blob/0b165b4/iOS/README.md#L34)

**Poddle at the hackathon (commit 7b0b37a):**
- **Architecture,** quoted from the README: "AirPod ──BLE──▶ motion/ (Swift, CoreMotion) ──stdout JSON──▶ bridge/ (ws :8787) ──▶ browser". Browsers then talk to `server/game.js` over WebSocket `:8080`, and that server owns the ball, contact and scoring. — [Poddle README L11-L18](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md)
- **Reader.** `motion/main.swift` is a command-line Swift program. It calls `CMHeadphoneMotionManager.startDeviceMotionUpdates(to: .main)` and writes `{"t": timestamp, "q": [x,y,z,w], "r": [x,y,z], "a": [x,y,z]}` per sample. A 4-second watchdog explains silent failures. — [motion/main.swift L16-L58](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/motion/main.swift)
- **Bridge.** `bridge/bridge.js` (Node, `ws` package) starts the Swift reader as a child process and forwards each stdout line to every connected browser on `WebSocketServer({ port: 8787 })`. — [bridge/bridge.js L1-L20](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/bridge/bridge.js)
- **Sample rate and jitter,** from the team's notes:
  - "AirPods Pro/3/Max expose a 50 Hz IMU" — [README L6-L7](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md)
  - "samples arrive in **pairs every ~40 ms**, with gaps up to 78 ms, even though the sensor clock ticks evenly at 20 ms" — [NOTES.md §4](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/NOTES.md)
- **Permission gotcha:** "a command-line Swift binary gets silently denied motion access unless an `Info.plist` with `NSMotionUsageDescription` is embedded in the binary (`-sectcreate __TEXT __info_plist`)". — [NOTES.md §1](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/NOTES.md)
- **After the hackathon (Poddle Helper).** Built from 2026-09-22 on, it replaced the Swift-plus-Node pair with a menu-bar app. That app runs its own WebSocket server on `127.0.0.1:8787` and `[::1]:8787`, only accepts pages from poddleball.com (checked by Origin), and sends `{"t","loc","q","r","a"}`. It requires "AirPods Pro, AirPods 3, AirPods 4 or AirPods Max" and Automatic Ear Detection turned off. — [poddle-helper README](https://github.com/danielrltan/poddle-helper/blob/20b0f09c46959f20ae2545f81e77e0e105cae7f2/README.md); [Sources/main.swift L1-L12, L34-L43, L204-L221](https://github.com/danielrltan/poddle-helper/blob/20b0f09c46959f20ae2545f81e77e0e105cae7f2/Sources/main.swift)

### Inferences
- **The three rate claims fit one pattern.** Poddle's "50 Hz", Aircade's "~50 Hz" and the ~30 Hz measurements all match a sensor that timestamps on a 20 ms (50 Hz) grid while Bluetooth delivers bursty, incomplete batches. In the Aircade capture about 46% of gaps were 20 ms and the rest were 40 to 100 ms. Treat about 30 to 35 delivered samples per second, arriving in bursts, as the realistic rate on a Mac. This is my inference from the two teams' data. Neither team states it.
- **The 24 ms median delay** assumes `CMLogItem.timestamp` and `ProcessInfo.systemUptime` use the same clock (both count seconds since boot). The figure is my own subtraction; the app does not compute it. It does **not** include Bluetooth air time if Core Motion stamps samples when they reach the Mac. The Aircade docs say their age figures are "not Bluetooth or motion-to-photon latency" ([DEVELOPMENT.md "Logs and evidence" L144-L152](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L144-L152)).
- **Neither project uses an iPhone to relay AirPod data.** The earbud pairs with the Mac and Core Motion on macOS 14+ reads it directly.

### Gaps
- Neither team published an end-to-end (motion-to-photon) latency figure for the AirPod path.
- Aircade's phone link reports round-trip time, but I found no recorded typical value in the repo.
- The AirPods models the teams used are not stated. Aircade's audio check mentions "AirPods Pro" as the system output device ([VERIFICATION.md L177](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L177)). Poddle lists supported models in general terms only.

## How does the game side consume the data, and how are motions turned into Wii-remote inputs?

### Takeaway
**Aircade** is a native macOS SwiftUI and SceneKit arcade with a Wii-style home menu. There is no emulator, DSU server or virtual gamepad. The orientation of the earbud, measured relative to a calibrated starting pose, drives three things:
- **The menu.** A pointer: lean left or right, tip toward or away from the screen, and hover for one second (dwell) to select.
- **The tennis racket.** It hits when it physically sweeps through the ball fast enough.
- **The light-saber games** (Neon Rush and Saber Duel). Swept-blade collision decides each cut.

The swing "trigger" (angular speed above 3 rad/s) only flashes the blade.

**Poddle** is a three.js browser game with a Node server that owns the ball. It turns orientation and rotation rate into a paddle pose on a virtual arm and into swing events (power, direction, lob). A swing opens a window of about 0.32 s on the server for contact.

### Cited Findings
**Aircade, game engine and input routing:**
- Built "natively with Swift, SwiftUI, SceneKit, and Core Motion". — [Devpost "How it works"](https://devpost.com/software/aircade-m4n6zv); [DEVELOPMENT.md L4](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L4)
- I searched the repo for dolphin, cemuhook, DSU, port 26760, wiimote, UDP, GameController and IOHID and found **no matches**. — [GitHub: apollo-ullah/Aircade](https://github.com/apollo-ullah/Aircade) at 0b165b4, local search
- `routeGameInput()` turns the latest fresh controller snapshot into a `SaberPose` (a fixed hilt position, or a camera-tracked one, plus the orientation quaternion). It hands the pose to `tennis.update` or `game.update`, but only if the sample is ready, fresh and new (checked with a session/sequence token). — [MotionModel.swift L724-L763](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L724-L763)

**Aircade, orientation mapping:**
- `OrientationTracker.update` works like this:
  - Relative rotation: relative = reference⁻¹ · q.
  - Grip-axis change: target = basis · relative · basis⁻¹.
  - Smoothing: slerp with weight 1 − e^(−dt/τ). The default τ is `smoothing = 0.045` s, and smoothing is turned off right after a gap.
  - Source: [Tracking.swift L4-L23](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/Tracking.swift#L4-L23); [MotionModel.swift L51, L501-L504](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L501-L504)
- Devpost: "When you calibrate the AirPod, its current orientation becomes your neutral position. From there, rotating the earbud rotates the racket in-game." — [Devpost "How it works"](https://devpost.com/software/aircade-m4n6zv)

**Aircade, Wii-style pointer and menu:**
- `PointerTracker` maps the calibrated "up" axis to a screen point between −1 and 1. The cone is ±22.5° side to side and ±13° up and down, with a 0.35° tremor dead zone. "Twisting its stem does not aim."
- If samples are more than 0.5 s old, the pointer holds its last position rather than snapping to the centre.
- Source: [Pointer.swift L4-L54](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/Pointer.swift#L4-L54)
- Selecting is done by **dwell**, since there is no button to press:
  - The pointer must first move by 0.035 of the screen ("armed").
  - It must wait 0.5 s after becoming ready.
  - Then it must hover over a target for 1.0 s, with sound cues.
  - Source: [ControllerMenu.swift L16-L33, L60-L87](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/ControllerMenu.swift#L16-L87)
- The team describes it as "left/right lean moves horizontally; tipping toward the screen moves down and tipping away moves up... a one-second visible dwell ring". — [VERIFICATION.md "AirPod menu navigation" L195-L197](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L195-L197)

**Aircade, swing and hit logic:**
- **Swing trigger.** `speed = |rotationRate|`. `SwingDetector` fires at `swingThreshold = 3.0` rad/s. It re-arms only after speed drops below 55% of the threshold and allows at most one swing per 0.3 s. — [Tracking.swift L60-L72](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/Tracking.swift#L60-L72); [MotionModel.swift L52, L493, L506-L509](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L506-L509)
- The docs explain that this threshold "only controls the blade flash. Scoring requires a swept geometric blade/block intersection and minimum contact speed." — [DEVELOPMENT.md "Saber controls" L134-L142](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L134-L142)
- **Tennis contact.** `RacketGeometry.sweep` moves a spherical ball against a finite elliptical racket face between two poses. Orientation follows the shortest-arc slerp, and samples more than 0.15 s apart are rejected. — [RacketGeometry.swift L34-L47](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/RacketGeometry.swift#L34-L47)
- A hit also needs rotation faster than 0.5 rad/s, or hand translation, between frames. — [TennisGame.swift L227-L236](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/TennisGame.swift#L227-L236)
- **Shot result.** `TennisShotResponse` needs a swing speed of at least 0.75 scene units/s. The face tilt mostly sets the aim (facing.x × 1.55, plus lateral swing × 0.28), and swing strength sets flight time between 1.35 s and 0.78 s. — [RacketGeometry.swift L139-L161](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/RacketGeometry.swift#L139-L161)
- Devpost: "Swinging randomly is not enough either. Your racket still has to physically intersect with the ball for the hit to count." — [Devpost "How it works"](https://devpost.com/software/aircade-m4n6zv)
- **Neon Rush (saber).** A 2.35-unit blade is swept against target boxes in steps of 0.035 units, so fast strokes do not pass through without hitting. — [Combat.swift L24, L42-L60](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/Combat.swift#L24-L60)
  - A cut needs a contact speed of at least 0.8 and a blade-edge alignment of at least 0.35.
  - Arrow targets need the right direction (dot product of at least 0.55 with left, right or down).
  - A "perfect" cut needs an alignment of at least 0.85 and a speed of at least 1.8.
  - Source: [NeonRush.swift L111-L135](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/NeonRush.swift#L111-L135)
- **Position.** The hilt stays at a fixed pivot unless the camera is on. Acceleration "is shown/logged, never integrated into position". With the camera on, Apple Vision's `VNDetectHumanHandPoseRequest` (wrist and knuckle points, confidence of at least 0.3) supplies a 2D hand position on the screen plane. — [DEVELOPMENT.md "Webcam movement" and "Saber controls" L109-L142](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L109-L142); [HandTracker.swift L29, L156-L157](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/HandTracker.swift#L156-L157); [MotionModel.swift L691-L706](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L691-L706)
- **Haptic feedback:**
  - Optional "TITAN Core" serial haptics use commands such as `CHNL n; Tick 0.8 20;`. — [TitanHaptics.swift L6-L27](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/TitanHaptics.swift#L6-L27)
  - The iPhone controller plays `UIImpactFeedbackGenerator` cues for hit, clash and damage. — [PhoneController.swift L162-L172](https://github.com/apollo-ullah/Aircade/blob/0b165b4/iOS/AircadeController/PhoneController.swift#L162-L172)
- **AI opponent** (context for the prize). The game sends the current state and five legal returns to "GPT-6 Astra through the OpenAI Responses API". The model picks a shot, and the native engine handles physics and contact. — [Devpost "Astra, the AI opponent"](https://devpost.com/software/aircade-m4n6zv)

**Poddle, game engine and mapping (commit 7b0b37a):**
- `web/motion.js` turns AirPod samples into the player's frame, a paddle pose and swing events. `web/scene.js` is the three.js court. `server/game.js` holds the authoritative ball, contact and scoring, and steps at a fixed 60 Hz. — [README L11-L18](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md); [server/game.js L1, L320-L322](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/server/game.js)
- **Swing detection:**
  - Trigger above 9 rad/s, 0.12 s peak window, re-arm at 3 rad/s.
  - Power = peak rate × credit for range of motion: no credit below 25° swept, full credit at 45° and 0.07 s.
  - Each swing event carries power, direction and lob.
  - Source: [web/motion.js L5-L30, L215-L240](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/web/motion.js)
  - The README: "a 50° flick scores nothing while a 130° forehand scores ~30... Sweep direction aims the shot, an upward scoop lobs it, peak speed sets power." — [README L31-L34](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md)
- **Contact on the server.** A swing stays "live" for `SWING_WINDOW = 0.32` s, with gentle swings getting longer windows. It hits when the ball is inside a contact box around the paddle, and misses report early, late, left, right, high or low. — [server/game.js L13-L14, L232, L283-L296](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/server/game.js); [README L37-L38](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md)
- **Paddle pose.** A "kinematic arm" places the paddle at the end of a virtual forearm so swings sweep an arc. Lateral position follows sin(yaw). Tilting the bud forward or back walks the player to the kitchen or the baseline. — [NOTES.md §2, §5](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/NOTES.md); [web/motion.js L9-L10](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/web/motion.js)
- **Sideways movement.** A webcam face detector, with a MediaPipe body-pose fallback, drives sideways movement (`web/bodytrack.js`). The alternatives are Wii-Sports-style automatic footwork or an "aim-move" mode. — [README L26-L30](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md)

### Inferences
- **The Wii comparison holds:**
  - Aircade's pointer stands in for the Wii's IR pointer, using tilt alone.
  - Its dwell-to-select stands in for the A button, because an earbud has no usable button for this.
  - Swing detection plus geometric contact stands in for Wii Sports-style swing gestures.
- Both teams added the webcam for position. That echoes the Wii's sensor bar, as Aircade's own notes say when they cite Wii MotionPlus ([DEVELOPMENT.md L195](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L195)).
- The AirPods' stem squeeze/press controls are not used as buttons in either codebase. I found no button-event handling.

### Gaps
- No team stated the end-to-end input lag in actual gameplay.
- Aircade's Devpost mentions a "How it works" screen that shows live readings. I did not check how well it matches the code beyond `SensorEvidenceView.swift`.

## How were calibration and drift handled?

### Takeaway
**Aircade** saves a neutral orientation and a grip "basis" for each earbud, so rotations line up with the screen whatever the grip. It calibrates from three poses: upright, tilt left, tip toward the screen. Pressing R re-centres. Any change of sending earbud, disconnect or gap of a second or more forces the player to re-centre.

**Poddle** calibrates in two steps: hold still for 5 s within 10°, then tip the bud up. Gravity supplies "up", and the tilt axis supplies "right". R re-zeroes yaw only, because "yaw drifts over minutes".

Neither project integrates acceleration into position, because it drifts too fast.

### Cited Findings
**Aircade:**
- **Three-pose calibration (`SimpleGripCalibration`):**
  - Capture 1 is the upright reference.
  - Capture 2 is the left-tilt rotation vector.
  - Capture 3 is the forward tilt, made perpendicular to the left axis (Gram–Schmidt).
  - The sensor axes (a, b, a×b) are mapped onto fixed game axes to build the basis quaternion.
  - Source: [SimpleGripCalibration.swift L13-L47](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/SimpleGripCalibration.swift#L13-L47)
- The basis is saved in UserDefaults as `grip.Left` or `grip.Right`, so each earbud has its own mapping. — [MotionModel.swift L958-L995](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L958-L995)
- **A stricter flow was built, then switched off.** That five-step flow took steady-window captures needing six or more samples, under 3° of spread and under 0.45 rad/s. At the user's request it was bypassed with `useSimpleCalibration = true`. — [MotionModel.swift L100-L102](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L100-L102); [VERIFICATION.md L79-L97](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L79-L97)
- **Re-centring.** `recenter()` sets the current raw orientation as the new reference (the R key). Fixed grip presets are rotations of ±90° about X or 180° about Y. — [MotionModel.swift L193-L201, L347-L358](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L347-L358)
- **Freshness and drift guards:**
  - Samples older than 0.25 s are dropped.
  - A repeated or backward sensor timestamp "must never refresh an old pose".
  - A gap of `trackingLossDelay = 1.0` s or more clears calibration and requires re-centring.
  - Source: [MotionModel.swift L339, L469-L483](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L469-L483); [ArcadeGame.swift L9-L10](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/ArcadeGame.swift#L9-L10)
- **Packet gaps during play.** "after 250 ms without motion, the game holds its clock and clears collision history... Same-earbud gaps under one second keep the grip reference... The first returning pose cannot score a connecting slash." — [DEVELOPMENT.md L73](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L73)
- **Drift.** "Orientation uses reference-relative quaternions, not Euler-angle subtraction." The team compared raw quaternion changes with the integrated gyro over the same samples and found median ratios of "0.996–0.999". On that evidence they chose to check which earbud was sending and to re-capture the reference, rather than apply an angle multiplier. — [DEVELOPMENT.md "Saber controls" L134-L142](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L134-L142); [VERIFICATION.md L77](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L77)
- **iPhone.** The phone has a single neutral capture ("I'm holding it upright"), because portrait phone axes already match the arena axes. — [PhoneOrientation.swift L3-L15](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/MotionCore/PhoneOrientation.swift#L3-L15); [iOS/README.md L18](https://github.com/apollo-ullah/Aircade/blob/0b165b4/iOS/README.md#L18)

**Poddle:**
- **Calibration:** "Two steps: hold still for 5 seconds (within 10°), then tip the bud up. The axis of that tilt, projected onto the horizontal plane, is the player's 'right'; gravity gives 'up'; their cross product gives 'toward the net'." — [NOTES.md §3](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/NOTES.md)
- In code: `HOLD_MS: 5000, HOLD_DEG: 10, TILT_DEG: 25, TILT_MIN_HORIZ: 0.75`. A twist is rejected as "That was a twist — level out, then tip it straight up." — [web/motion.js L7-L9, L133-L169](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/web/motion.js)
- **Drift.** R re-centres because "yaw drifts over minutes". `recenter()` "Re-zero[es] heading only... Grip and pitch are kept." Tilt-to-walk uses gravity, "the most drift-free signal the sensor has". — [README L59](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md); [web/motion.js L99-L103](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/web/motion.js); [NOTES.md §2](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/NOTES.md)
- **Jitter buffer.** The paddle is drawn about 65 ms in the past and only interpolates between real samples. "roughness fell from 565 % to 9 % of a frame step". — [NOTES.md §4](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/NOTES.md); [README L22-L23](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/README.md)

### Inferences
- Aircade fights drift with frequent manual re-centring, plus forced re-centring after an earbud change or a gap of a second or more. It has no automatic yaw correction. Poddle re-zeroes yaw only and keeps gravity-referenced pitch, which suits a game where heading matters less than tilt.

### Gaps
- Neither project measured yaw drift per minute on held earbuds.

## Did they also use phones, Apple Watches or other devices, and what limitations or challenges did they report?

### Takeaway
**Aircade:**
- Adds an **iPhone** as the second player. The public headphone API gives only one active AirPods motion stream per pair at a time, and the app cannot choose which earbud sends it.
- Uses an optional **webcam** (Apple Vision hand pose) for hand position, and optional TITAN serial haptics.
- Has no Apple Watch support.

Aircade's reported challenges:
- Getting any samples at all.
- Out-of-ear streaming, which needs Automatic Ear Detection turned off.
- The source silently switching between left and right earbuds.
- Packet gaps of about 280 ms.
- The lack of absolute position.
- Calibration UX.

**Poddle** added a webcam for body position and, after the hackathon, phones as paddles. It reported bursty jitter, silent permission denial for a command-line binary, the "paddle rotates in place" problem, and telling flicks from real swings.

### Cited Findings
**Aircade, devices:**
- "The public headphone API also only gives us one active AirPods motion stream at a time, so our two-player mode pairs an AirPod with an iPhone." — [Devpost "How it works"](https://devpost.com/software/aircade-m4n6zv)
- "`CMHeadphoneMotionManager` has no public setter to choose the left or right sensor. Aircade now pins the first known source... and requires an explicit handover when macOS changes the source." — [VERIFICATION.md L75](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L75); [MotionModel.swift L448-L467](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Sources/Aircade/MotionModel.swift#L448-L467)
- The iPhone companion is a native iOS app, "Aircade Controller". Both devices must be on the same Wi-Fi or a personal hotspot, with Motion & Fitness and Local Network permissions. Users hold it "portrait, screen facing you, top edge up". — [iOS/README.md L17-L18](https://github.com/apollo-ullah/Aircade/blob/0b165b4/iOS/README.md#L17-L18); [PhoneController.swift L80, L123](https://github.com/apollo-ullah/Aircade/blob/0b165b4/iOS/AircadeController/PhoneController.swift#L80)
- "Because headphone motion gives us rotation rather than absolute hand position, optional camera tracking can provide a separate position signal." — [Devpost "How it works"](https://devpost.com/software/aircade-m4n6zv)
- I found no Apple Watch code (no WatchKit target) in the repo. The package targets are macOS and iOS only. — [Package.swift L6-L17](https://github.com/apollo-ullah/Aircade/blob/0b165b4/Package.swift)

**Aircade, reported challenges:**
- **Zero samples at first:** "the old app received zero motion samples even after a normal restart with the earbuds worn." The fix: "Moved Core Motion callbacks off the main operation queue, added a thread-safe latest-reading buffer... made each reconnect create a fresh manager." — [VERIFICATION.md L61](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L61)
- **Earbud switching:** "The user reported an unresponsive final capture while holding the Right AirPod; live logs showed the motion source was Left." — [VERIFICATION.md L69](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L69)
- **Packet gaps after hits:** "The **280.1 ms** receipt gap exceeded the old **250 ms** instant-pause threshold." The fix separated collision freshness (250 ms) from confirmed tracking loss (1 s). — [VERIFICATION.md L121-L123](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L121-L123)
- **Launch path:** "A direct executable launch encountered macOS TCC attribution failure; the supported launch path is the app bundle." — [VERIFICATION.md L21](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L21)
- **Menu cursor starvation:** "high-frequency MotionModel publications reconstructed the shell's timer publisher and could starve cursor updates." — [VERIFICATION.md L199](https://github.com/apollo-ullah/Aircade/blob/0b165b4/VERIFICATION.md#L199)
- **Devpost challenges were AI-side:** a scheduler bug that "reported seven instant rate-limit failures", and a menu freeze from configuration reads during UI rendering. — [Devpost "Building it with Codex"](https://devpost.com/software/aircade-m4n6zv)
- **Deferred work:** "External USB haptic motors, multiple simultaneous phones, turn-based shared-earbud games and player avatars are deferred." — [DEVELOPMENT.md L191](https://github.com/apollo-ullah/Aircade/blob/0b165b4/DEVELOPMENT.md#L191)

**Poddle:**
- Post-hackathon, poddleball.com lets "a phone act as the paddle by scanning a QR code or entering a room code", and "The AirPod option is Mac-only". — [WebSearch summary of Poddle listings (Product Hunt)](https://producthunt.com/products/poddle-3) (unverified listing); consistent with the [poddle-helper README](https://github.com/danielrltan/poddle-helper/blob/20b0f09c46959f20ae2545f81e77e0e105cae7f2/README.md) ("You can play Poddle with your phone as the paddle... This app is only for playing with an AirPod on a Mac.")
- **Reported challenges** (from NOTES.md, "Build log for Hack the North 2026"):
  - Streaming normally needs the earbud to be worn. That was solved by turning off Automatic Ear Detection with the other bud in the case.
  - "Real paddle swings peak around 35 rad/s."
  - A command-line binary is silently denied motion access without an embedded Info.plist.
  - There is no position sensor ("Double-integrating acceleration drifts by metres within a second or two").
  - Jitter: samples arrive in pairs.
  - The paddle "rotated in place".
  - Fast left-right movement lagged, because a 5 m/s cap and a 5.5 rad/s wind-up threshold both caught quick zigzags.
  - Hit registration.
  - Flicks versus arm swings.
  - A stale LAN IP in the URL.
  - The laptop slept and "stalled a long-running job for three hours".
  - Source: [NOTES.md §1-§10](https://github.com/danielrltan/poddle/blob/7b0b37ada91f7d079e60a8e16ef844d42831877c/NOTES.md)
- **Devpost challenges** for Poddle: choosing the idea, "explored ideas ranging from posture tracking to handwriting recognition", and the fact that "A natural swing can vary significantly between players, making it challenging to consistently distinguish deliberate shots from ordinary movement." — [Devpost: Poddle](https://devpost.com/software/wip-zdq95m)

### Inferences
- **The one-stream rule shaped both designs.** Aircade's second player had to be an iPhone. Poddle runs one AirPod per Mac, and two players need two laptops (the README says to run the bridge on "every player's Mac").
- **Mac-only.** Both projects run on macOS. Neither offers a way to play on Windows or Linux, and both depend on macOS 14+ having `CMHeadphoneMotionManager`.

### Gaps
- I found no Apple Watch use in either project.
- I could not confirm the exact AirPods models used at the event.
- **How complete the project list is.** My gallery scan matched names and taglines only, so a Hack the North 2026 project that mentions AirPods only in its body text could be missed. Devpost-wide searches by an earlier researcher ("airpods", "airpod", "airpods wii", "wii remote", "head tracking", "headphone motion", "CMHeadphoneMotionManager" and similar) also found no other Hack the North 2026 AirPods entries besides Aircade and Poddle.
