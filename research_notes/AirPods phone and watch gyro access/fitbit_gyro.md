# Reading raw gyroscope and accelerometer data from Fitbit devices (as of 2026-11-07)

Unless marked otherwise, every source below was fetched and read directly on 2026-11-07 (local date). The endpoint probes ran at 2026-11-08 02:43 UTC. All dev.fitbit.com pages carry a 2026 banner about the Web API shutdown, so they are live pages, but most of their SDK content dates from 2018-2023. "Official" means dev.fitbit.com, Google help, Google Store, developers.google.com, developer.android.com, developer.samsung.com or developer.garmin.com. Everything else (9to5Google, GitHub community projects, forums) is labelled as such.

## Device matrix: which Fitbit models have a gyroscope and which support third-party apps

### Takeaway
Only three Fitbit OS watches ever exposed a gyroscope to third-party apps: Ionic (since recalled, and owners are told to stop using it), the original Versa, and Sense. Versa Lite, Versa 2 and Versa 3 run third-party apps but have no gyroscope. Versa 4 and Sense 2 allow only clock faces (Sense 2 has a gyroscope; Versa 4 does not). Trackers (Charge 5/6, Inspire 3, Luxe, Ace 3) and the 2024-2026 devices (Ace LTE, Fitbit Air, Fitbit Edge) have no third-party app platform. The only Fitbit/Google wearable that has both a gyroscope and an open app platform today is the Pixel Watch, which runs Wear OS.

### Matrix (synthesised from the cited findings below)
| Device | Gyroscope | Third-party apps | SDK build target / platform |
|---|---|---|---|
| Ionic (2017) | Yes (2021 SDK guide) | Yes in the SDK 4.x era (implied by its listing in the 2021 SDK guide); recalled, owners told to stop using it | not in current docs |
| Versa (2018) | Yes per SDK guide; manual omits it (conflict) | Yes, Fitbit OS 4 / SDK 4.x | meson |
| Versa Lite | No | Yes, Fitbit OS 4 / SDK 4.x | gemini |
| Versa 2 | No | Yes, Fitbit OS 4 / SDK 4.x | mira |
| Versa 3 | No | Yes, Fitbit OS 5 / SDK 5-6 | atlas |
| Sense | Yes | Yes, Fitbit OS 5 / SDK 5-6 | vulcan |
| Versa 4 | No (absent from Google Store spec list) | No, clock faces only | hera/rhea added to toolchain 2023 (not in docs) |
| Sense 2 | Yes (Google Store specs) | No, clock faces only | as above |
| Charge 5 | No | No | n/a (no SDK) |
| Charge 6 | No | No (only Google apps such as Maps, YouTube Music) | n/a (no SDK) |
| Inspire 3 | No | No | n/a (no SDK) |
| Luxe | No | No | n/a (no SDK) |
| Ace 3 | No (accelerometer only) | No | n/a (no SDK) |
| Ace LTE (2024) | Yes | No ("no Play Store, third-party apps") | Wear OS-based, closed |
| Fitbit Edge (Oct 2026) | Yes (per 9to5Google) | No SDK mentioned | "a Fitbit operating system similar to the Air" |
| Fitbit Air (May 2026) | not found | not found | Fitbit OS (per 9to5Google) |
| Pixel Watch 3, 4, 5 (Pixel Watch 1 and 2 not checked) | Yes | Yes (Wear OS apps) | Wear OS (Pixel Watch 5: Wear OS 7.0) |

### Cited Findings
- Current SDK guide (verbatim): "Note: Only the Fitbit Versa and Fitbit Sense contain a gyroscope sensor." — [Fitbit Gyroscope Sensor Guide](https://dev.fitbit.com/build/guides/sensors/gyroscope/)
- Orientation, same wording: "Note: Only the Fitbit Versa and Fitbit Sense contain the orientation sensor." — [Fitbit Orientation Sensor Guide](https://dev.fitbit.com/build/guides/sensors/orientation/)
- Archived 2021 copy of the gyroscope guide: "Note: Only the Fitbit Ionic, Fitbit Versa, and Fitbit Sense contain a gyroscope sensor." The Ionic was later dropped from the note. — [Wayback snapshot 2021-04-19 of the Gyroscope Sensor Guide](https://web.archive.org/web/20210419204722/https://dev.fitbit.com/build/guides/sensors/gyroscope/)
- Current build targets: Fitbit OS 5 = Versa 3 (atlas, modelId 36) and Sense (vulcan, 44); Fitbit OS 4 = Versa (meson, 32), Versa Lite (gemini, 38) and Versa 2 (mira, 35). Ionic, Versa 4 and Sense 2 are not listed. — [Fitbit Multiple Devices guide](https://dev.fitbit.com/build/guides/multiple-devices/)
- SDK 6.0 shipped for "Fitbit Sense and Fitbit Versa 3" (firmware 5.2). Fitbit chose to "maintain a version of SDK 4.x so developers can continue to build apps and clocks for our legacy smartwatches", and said the Command Line SDK "can continue to be used for SDK 4.x with physical devices" (blog, 2021-07-20). — [Announcing Fitbit OS SDK 6.0](https://dev.fitbit.com/blog/2021-07-20-announcing-fitbit-os-sdk-6.0/)
- The open-source toolchain added "rhea/hera build targets (#310)" on 2023-03-08 (tag 7.1.0-pre.1); its last commit is 2023-08-28. — [GitHub Google-Health-API/fitbit-sdk-toolchain](https://github.com/Google-Health-API/fitbit-sdk-toolchain)
- Sense 2 and Versa 4: "The Sense 2 and Versa 4 lack third-party app support, and that's not going to change. Fitbit told 9to5Google today that it does 'not have plans to offer third party apps on these health and wellness focused devices.' It will, however, continue to 'offer a range of Fitbit and developer created clock faces for Sense 2 and Versa 4.'" (9to5Google, Abner Li, 2023-02-17; news source) — [9to5Google](https://9to5google.com/2023/02/17/fitbit-studio/)
- Ionic recall: "voluntary recall of Fitbit Ionic smartwatches ... The battery in the Ionic smartwatch can overheat, posing a burn hazard ... If you own a Fitbit Ionic, please stop using your device." — [Google Health Help: Safety Recall of Ionic](https://support.google.com/googlehealth/answer/15118230?hl=en)
- "Sensors and Components" in the official manuals (PDFs linked from Google's manuals page):
  - Versa (v2.9): optical HR, altimeter, 3-axis accelerometer, ambient light, vibration motor. No gyroscope listed.
  - Versa Lite (v2.9): optical HR, 3-axis accelerometer, ambient light, vibration. No gyroscope and no altimeter.
  - Versa 2 (v1.4): optical HR, altimeter, 3-axis accelerometer, ambient light, vibration, microphone.
  - Versa 3 (v1.3): optical HR, altimeter, 3-axis accelerometer, ambient light, GPS+GLONASS, device temperature, vibration, speaker, microphone.
  - Sense (v2.0): "Gyroscope", altimeter, 3-axis accelerometer, ECG/EDA electrical sensors, skin temperature, GPS, speaker, microphone.
  - Charge 5 (v1.8): optical HR, 3-axis accelerometer, ambient light, GPS, EDA sensors.
  - Luxe (v1.10): optical HR, 3-axis accelerometer, ambient light.
  - Ace 3 (v1.7): 3-axis accelerometer and vibration motor only.
  - Sources: [Google Health Help: Fitbit user manuals](https://support.google.com/googlehealth/answer/14253977?hl=en); PDFs for [Versa](https://storage.googleapis.com/support-kms-prod/aPbS6cdkChepr3Xoz8DQ3B5hbFEj7Sh0Bo3l), [Versa Lite](https://storage.googleapis.com/support-kms-prod/dMSJLOeGUydFmFghPtqfplt4lunTD2hP8FtP), [Versa 2](https://storage.googleapis.com/support-kms-prod/PXp6xwhJFCZ5wplJ3Jfh3IzwzBsHbBqwizWJ), [Versa 3](https://storage.googleapis.com/support-kms-prod/VXhL1YSgUaG2GbZI6yUwRBV00VpsMidm3G87), [Sense](https://storage.googleapis.com/support-kms-prod/dRZ4lIXOhI8ZNsnPbvwiG2r7FGBqwrNVka3j), [Charge 5](https://storage.googleapis.com/support-kms-prod/O57BuXQq2b3CXWhyct64LFKUubeXR08FkagT), [Luxe](https://storage.googleapis.com/support-kms-prod/7FG7zZ6x6txKflbKRnArRmFPrpWw5DcrIq6J), [Ace 3](https://storage.googleapis.com/support-kms-prod/KhRaOIIYvvRfPykJNnMIL9bVijQUdw9iAsUo)
- CONFLICT (original Versa): its manual lists no gyroscope, but Fitbit's SDK guide (2021 and current) says the Versa has one. — [Versa manual](https://storage.googleapis.com/support-kms-prod/aPbS6cdkChepr3Xoz8DQ3B5hbFEj7Sh0Bo3l); contradicted by [Gyroscope Sensor Guide](https://dev.fitbit.com/build/guides/sensors/gyroscope/)
- Google Store tech specs:
  - Sense 2: "Gyroscope", altimeter, 3-axis accelerometer.
  - Versa 4: altimeter, 3-axis accelerometer, ambient light, NFC, GPS and "WiFi (deactivated, cannot be turned on)". No gyroscope.
  - Charge 6: 3-axis accelerometer and GPS. No gyroscope.
  - Inspire 3: 3-axis accelerometer. No gyroscope.
  - Fitbit Ace LTE: Accelerometer, Altimeter, Magnetometer, "Gyroscope".
  - Pixel Watch 3, 4 and 5: 3-axis accelerometer, "Gyroscope", magnetometer, barometer. Pixel Watch 5: "OS Wear OS 7.0" and "Works with most phones running on Android 12.0 or newer. Requires Google Account and Google Pixel Watch app."
  - Sources: [Sense 2](https://store.google.com/us/product/fitbit_sense_2_specs?hl=en-US), [Versa 4](https://store.google.com/us/product/fitbit_versa_4_specs?hl=en-US), [Charge 6](https://store.google.com/us/product/fitbit_charge_6_specs?hl=en-US), [Inspire 3](https://store.google.com/us/product/fitbit_inspire_3_specs?hl=en-US), [Ace LTE](https://store.google.com/us/product/fitbit_ace_lte_specs?hl=en-US), [Pixel Watch 3](https://store.google.com/us/product/pixel_watch_3_specs?hl=en-US), [Pixel Watch 4](https://store.google.com/us/product/pixel_watch_4_specs?hl=en-US), [Pixel Watch 5](https://store.google.com/us/product/pixel_watch_5_specs?hl=en-US)
- Ace LTE is "Google's newest wearable powered by Wear OS ... However, there's no Play Store, third-party apps, or advertising." (9to5Google, 2024-05-29; news source) — [9to5Google](https://9to5google.com/2024/05/29/google-fitbit-ace-lte-announcement/)
- Fitbit Edge (9to5Google, Abner Li, 2026-10-12; news source): announced 2026-10-12 at $179.99, available 2026-10-27. It runs "a Fitbit operating system similar to the Air". Sensors include accelerometer, altimeter, ambient light, far-field skin temperature, gyroscope, heart rate, ECG electrodes and SpO2. It has about a dozen built-in watch faces, and the article mentions no SDK or third-party apps. It follows the Fitbit Air, launched in May 2026. — [9to5Google](https://9to5google.com/2026/10/12/google-fitbit-edge/)
- Google's manuals page lists "Google Fitbit Edge" and "Google Fitbit Air" under new devices. — [Google Health Help: Fitbit user manuals](https://support.google.com/googlehealth/answer/14253977?hl=en)
- The third-party app/clock change covers these smartwatches: Sense 2, Sense, Versa 4, Versa 3, Versa 2, Versa Lite, Versa and Ionic. The same help pages say Google Maps runs on "Google Fitbit Edge, Charge 6, Sense 2 and Versa 4", and that YouTube Music controls run on Edge and Charge 6. Both are Google apps, not third-party ones. — [Google Health Help 14237121](https://support.google.com/googlehealth/answer/14237121?hl=en), [14237125](https://support.google.com/googlehealth/answer/14237125?hl=en)

### Inferences
- The only Fitbit OS devices with gyroscope API support (Versa 2018, Sense 2020) are discontinued hardware, so a team would need a used unit. Given the Versa manual/SDK conflict, check `if (Gyroscope)` on the actual watch.
- Sense 2 has a gyroscope, but Fitbit allows only clock faces on it. No documentation says a clock face can read the gyroscope, and a clock face is not a practical way to stream data.
- The trackers give no third-party code access, so raw IMU data on them cannot be reached by any documented route.

### Gaps
- No official spec page for the Ionic, Fitbit Edge or Fitbit Air was read; the Edge sensor list comes from 9to5Google. The Air's sensors were not researched.
- Whether hera/rhea (Versa 4/Sense 2) clock-face builds can access motion sensors is undocumented.

## Fitbit OS SDK: sensor APIs, units, rates, permissions, and a streaming pattern

### Takeaway
On a supported watch, an app reads raw motion through three modules, each built with `{ frequency, batch }` and needing no permission:
- `accelerometer`: m/s^2, gravity included.
- `gyroscope`: rad/s.
- `orientation`: a unit quaternion.

The only documented rate is the accelerometer's 100 Hz default, and the docs say the actual rate may differ from the one requested. Data leaves the watch only through the Messaging API or File Transfer, to a companion that runs inside the Fitbit phone app (now the Google Health app):
- Messaging is CBOR-encoded, limited to 1027-byte messages, and best-effort.
- The companion can forward data with `fetch` (HTTPS only, except local-network IP addresses) or with a `WebSocket`.

### Cited Findings
Sensor modules (official docs):
- `import { Accelerometer } from "accelerometer";` "This constructor will not be defined on devices that have no accelerometer." x/y/z are in m/s^2, and "Acceleration readings include the acceleration of gravity" (about 9.8 m/s^2 on z when the watch lies flat). — [Accelerometer API reference](https://dev.fitbit.com/build/reference/device-api/accelerometer/)
- "By default, the accelerometer sample rate is 100Hz (100 times per second)." The guide's example is `new Accelerometer({ frequency: 30, batch: 60 })`, with the comment "the callback will be called once every two seconds". — [Accelerometer Sensor Guide](https://dev.fitbit.com/build/guides/sensors/accelerometer/)
- `import { Gyroscope } from "gyroscope";` `Gyroscope` is typed `IGyroscope | undefined`. Readings are angular velocity in rad/s, with signs following the right-hand rule. Batched `readings` (New in SDK 2.0) have `timestamp` as a Uint32Array and `x`/`y`/`z` as Float32Arrays. — [Gyroscope API reference](https://dev.fitbit.com/build/reference/device-api/gyroscope/)
- The gyroscope guide's example is `new Gyroscope({ frequency: 30, batch: 60 })` ("30 readings per second, 60 readings per batch"). Its battery practice is `display.on ? gyro.start() : gyro.stop()`. — [Gyroscope Sensor Guide](https://dev.fitbit.com/build/guides/sensors/gyroscope/)
- `import { OrientationSensor } from "orientation";`
  - Each reading is a four-element unit quaternion (scalar, i, j, k).
  - "The orientation of X and Y relative to the earth can drift over time"; the Z axis is "perpendicular to the ground and points towards the sky".
  - The guide's example uses `frequency: 60`. Batched channels are `scalar`, `i`, `j`, `k` and `timestamp`.
  - Sources: [Orientation Sensor Guide](https://dev.fitbit.com/build/guides/sensors/orientation/), [Orientation API reference](https://dev.fitbit.com/build/reference/device-api/orientation/)
- Common Sensor interface (all from the Sensors API reference):
  - Members: `start()`, `stop()`, `setOptions(options)` ("New in SDK 4.0", works while the sensor runs), `activated`, `onactivate`, `onerror` (the sensor stops automatically on error) and `onreading`.
  - `frequency` (SensorOptions): "Desired sampling frequency in Hz. The actual sampling frequency of the sensor may be different from the desired frequency, depending on various constraints from the driver and/or hardware capabilities." Use the timestamps to find the real rate.
  - `batch` (New in SDK 2.0): "with a frequency of 30 and a batch size of 60, the 'reading' event can be expected to be emitted about every 2 seconds".
  - Timestamps are in ms, "relative to an unspecified arbitrary 0 time".
  - Source: [Sensors API reference](https://dev.fitbit.com/build/reference/device-api/sensors/)
- No permission is listed for accelerometer, gyroscope or orientation. The permissions that exist gate heart rate (`access_heart_rate`), companion internet access (`access_internet`), the background companion (`run_background`), location and others. — [Fitbit Permissions guide](https://dev.fitbit.com/build/guides/permissions/)
- No maximum frequency is documented on any sensor page; the only number given is the 100 Hz accelerometer default. — [Accelerometer Sensor Guide](https://dev.fitbit.com/build/guides/sensors/accelerometer/), [Sensors API reference](https://dev.fitbit.com/build/reference/device-api/sensors/)
- Minor doc inconsistency: the guides say the X axis runs "in the top-bottom direction", while the API reference says x runs "in the left-to-right direction" along the top and bottom edges. — [Gyroscope Sensor Guide](https://dev.fitbit.com/build/guides/sensors/gyroscope/); contradicted by [Accelerometer API reference](https://dev.fitbit.com/build/reference/device-api/accelerometer/)

Getting data off the watch:
- Messaging: `import * as messaging from "messaging";` works the same on the device and the companion. "This API is a subset of the WebSocket API"; "Connections are established automatically"; data is "automatically encoded using CBOR" (Number, String, ArrayBuffer/ArrayBufferView, true/false/null/undefined, Arrays, Objects). — [Messaging guide](https://dev.fitbit.com/build/guides/communications/messaging/)
- Size limit (verbatim): "the maximum size of a single serialized message is 1027 bytes (MAX_MESSAGE_SIZE). This means that due to serialization, the largest blob of data using Uint8Array is 1024 bytes. Sending a message which exceeds this size limit will trigger an exception." Larger payloads must be split, or sent with the File Transfer API. — [Messaging guide](https://dev.fitbit.com/build/guides/communications/messaging/)
- Buffering: "The actual buffer size will vary depending upon the application's available memory." Watch `bufferedAmount` and the `bufferedamountdecrease` event; the example sends only while `bufferedAmount < 128`. No message-rate limit is documented. — [Messaging guide](https://dev.fitbit.com/build/guides/communications/messaging/)
- peerSocket exposes `readyState` (OPEN/CLOSED), `MAX_MESSAGE_SIZE` and `bufferedAmount`. Close codes are CONNECTION_LOST, PEER_INITIATED and SOCKET_ERROR. — [Messaging API reference](https://dev.fitbit.com/build/reference/device-api/messaging/)
- The companion is "an additional JavaScript runtime environment which exists within the Fitbit mobile application". "A companion may not always be actively running due to mobile phone battery optimization." `wakeInterval` takes a value of at least 300,000 ms (5 minutes) and is "a mere guidance to the mobile runtime, not a guarantee". — [Companion guide](https://dev.fitbit.com/build/guides/companion/)
- Companion fetch: "fetch() can only be used to access https endpoints and resources, except when accessing resources on a local network by IP address." Network access needs the `access_internet` permission. — [Companion Fetch API reference](https://dev.fitbit.com/build/reference/companion-api/fetch/), [Permissions guide](https://dev.fitbit.com/build/guides/permissions/)
- Companion WebSocket: the standard `new WebSocket(wsUri)` with open/close/message/error events and `binaryType`; the doc example uses `wss://`. — [Companion WebSocket API reference](https://dev.fitbit.com/build/reference/companion-api/websocket/)
- Working community pattern: gondwanasoft/fitbit-stream-bridge (community project, last push 2023-09-03).
  - The watch app streams `new Accelerometer({ frequency: 30 })` readings as small binary buffers over peerSocket.
  - The companion is a WebSocket client to `ws://127.0.0.1:8080`, a Python `websockets` server that runs on the phone itself (Pydroid 3 on Android) and relays the data to a browser client on the LAN.
  - The README says the phone-side server "avoids the need to use `wss` (`https`), which can be difficult to set up on a LAN".
  - Issues it lists: "The Fitbit messaging API may not reopen a closed connection ... the app may need to be restarted"; monitor `peerSocket.bufferedAmount` on both sides; messaging and websockets are "not appropriate if the goal is to save data to a file ... messages will be dropped if necessary."
  - Source: [GitHub gondwanasoft/fitbit-stream-bridge](https://github.com/gondwanasoft/fitbit-stream-bridge)

### Inferences
- Throughput budget: one 1024-byte binary message holds 256 float32 values. That is about 42 six-axis samples (accel x/y/z plus gyro x/y/z) with no timestamps, or about 36 with a 4-byte timestamp each. At 50 Hz this is under two messages per second, which seems feasible, but nothing official guarantees throughput. Batch on the watch, send ArrayBuffers, and expect dropped messages.
- To keep complete recordings, write batches to a file on the watch and send them with the File Transfer API rather than live messaging. This follows from the stream-bridge warning and from the messaging guide's pointer to File Transfer.
- Pattern sketch. This is my own synthesis from the documented APIs above, not tested. It only matters for devices that already have the app installed (see the next section).
  - Watch (`app/index.js`):
    - `import { Gyroscope } from "gyroscope"; import { Accelerometer } from "accelerometer"; import * as messaging from "messaging";`
    - Create `new Gyroscope({ frequency: 50, batch: 25 })`, and likewise `new Accelerometer(...)`.
    - On `reading`, pack `readings.x/y/z` (Float32Array) plus the first `readings.timestamp` and a sensor id into a single `Float32Array` (25 × 3 + 2 = 77 floats, 308 bytes).
    - If `messaging.peerSocket.readyState === messaging.peerSocket.OPEN` and `bufferedAmount` is small, call `peerSocket.send(buf.buffer)`. Otherwise drop the batch, or queue it and wait for `bufferedamountdecrease`.
  - Companion (`companion/index.js`):
    - Open `ws = new WebSocket("wss://<server>")`, set `ws.binaryType = "arraybuffer"`, and in the `messaging.peerSocket` `message` handler forward `evt.data` with `ws.send(...)`.
    - Alternatively, POST batches with `fetch` to an HTTPS endpoint or a LAN IP address.
    - Request `access_internet` in `package.json`.

### Gaps
- No official maximum sampling rate for the gyroscope or orientation sensor; it has to be measured from timestamps on the device.
- No official peerSocket throughput figures. A "60 Hz" streaming claim seen in a forum search result could not be verified (the forum now redirects, see below).
- Whether the companion WebSocket accepts plain `ws://` to non-local hosts is not stated in the docs (the stream-bridge README implies `wss` is needed off-phone).

## Is the Fitbit OS SDK still usable in late 2026, and what changed with Google accounts?

### Takeaway
As of 2026-11-07 the Fitbit OS SDK is effectively at end of life:
- The docs are still online, but the CLI and SDK packages have not been updated since 2023.
- The CLI's OAuth login endpoints on api.fitbit.com now return HTTP 410 ("retired on October 30, 2026"), so logging in to the shell, and therefore sideloading over the developer bridge, almost certainly no longer works. This is inferred, not tested.
- Google says that from November 28, 2026, nobody can install or update third-party apps or clock faces on Fitbit smartwatches. Already-installed ones keep working until they are deleted or the watch is reset.
- Before that, developer tools had been tied to migrating to a Google Account. The Fitbit-account cutoff moved from 2026-02-02 to 2026-05-19, and the Fitbit app became the Google Health app on 2026-05-19.
- Fitbit Studio has been gone since April 2023.

### Cited Findings
- Google's help pages: "Starting on November 28, 2026, you can no longer install or update third-party apps and clocks on Fitbit smartwatches. After this date, your installed apps and clock faces from third-party developers will continue to work. However, if you choose to delete an app or clock face, or factory reset your device, you will no longer be able to re-install it." Apps made by Fitbit and Google remain ("Please update to app version 5.12"). — [Google Health Help 14237121](https://support.google.com/googlehealth/answer/14237121?hl=en), [14226056](https://support.google.com/googlehealth/answer/14226056?hl=en), [14237125](https://support.google.com/googlehealth/answer/14237125?hl=en)
- Private distribution (the documented alternative to sideloading): "Privately published apps are not visible within the Fitbit App Gallery, and can only be installed by clicking on a direct installation hyperlink ... By default, all apps are privately published". Google's help page describes privately shared apps as "typically used for developer testing". — [Fitbit Publishing guide](https://dev.fitbit.com/build/guides/publishing/), [Google Health Help 14237121](https://support.google.com/googlehealth/answer/14237121?hl=en)
- Developer blog, "Fitbit dev tools are moving to Google Accounts" (Maksim Turchyn, 2025-08-08):
  - "Any third-party apps you've created for Fitbit devices using your current Fitbit login credentials will be deleted unless you move to a Google Account. After Feb. 2, 2026, you won't be able to access Fitbit with your current login credentials. To maintain access to developer tools and dev.fitbit.com, move your Fitbit account to a Google Account now."
  - For clock face and device app developers: "New user activations will be blocked and you will not be able to access your app or clock face using your Fitbit account."
  - Source: [Fitbit Developer Blog](https://dev.fitbit.com/blog/2025-08-08-fitbit-dev-tools-moving-to-google-accounts/)
- The account deadline then moved (9to5Google, Ben Schoon, 2026-01-31; news source): "Google has pushed the deadline for the move from Fitbit accounts to Google Account back to May 19, 2026. Previously, the deadline was February 2, 2026." Non-migrated users could download their data until July 15, 2026, "at which point that data will be deleted." — [9to5Google](https://9to5google.com/2026/01/31/fitbit-google-account-may-2026-deadline/)
- App rename: "Starting May 19, 2026, the Fitbit app will become the Google Health app"; "If your Fitbit app is connected to a Fitbit account instead of a Google account, you will need to move your Fitbit account to Google to use the Google Health app." — [Google Health Help: redesigned Google Health app](https://support.google.com/googlehealth/answer/17068213?hl=en)
- The newest developer-blog posts are dated 2025-09-26 (Web API updates), 2025-08-08 (Google Accounts) and 2024-07-02. The last SDK release announcement is SDK 6.0 (2021-07-20). — [Fitbit Developer Blog](https://dev.fitbit.com/blog/)
- Fitbit Studio: "Fitbit Studio was fully shut down on April 20, 2023 ... switch to using the command-line SDK". — [dev.fitbit.com Fitbit Studio page](https://dev.fitbit.com/build/fitbit-studio)
- CLI guide: "Installation and logging is handled via the developer bridge ... you need an active internet connection to use the Fitbit shell to install apps onto your device or the simulator." Node.js 14 is recommended, and the migration guide pins `@fitbit/sdk-cli@^1.7.3`. On the watch, the docs say to go to "Settings > Developer Bridge" and wait for "Connected to Server". — [Command Line Interface guide](https://dev.fitbit.com/build/guides/command-line-interface/), [Getting Started](https://dev.fitbit.com/getting-started/), [Migration guide](https://dev.fitbit.com/build/guides/migration/)
- How the CLI logs in (open-source code):
  - It uses OAuth against `${apiUrl}/oauth2/authorize` and `${apiUrl}/oauth2/token`, where the production `apiUrl` is `https://api.fitbit.com:443` (client ID `22D2CP`, scope `profile`).
  - It then lists developer-bridge hosts at `1/user/-/developer-relay/hosts.json`. The relay itself is `wss://027-v3-api-soa.fitbit.com:443/dbridge/`.
  - Sources: [developer-bridge auth/index.ts](https://github.com/Google-Health-API/developer-bridge/blob/master/packages/sdk-cli/src/auth/index.ts), [environments.json](https://github.com/Google-Health-API/developer-bridge/blob/master/packages/sdk-cli/src/auth/environments.json), [developerRelay.ts](https://github.com/Google-Health-API/developer-bridge/blob/master/packages/sdk-cli/src/api/developerRelay.ts)
- Endpoint probes (direct, 2026-11-08 02:43 UTC; endpoints taken from [environments.json](https://github.com/Google-Health-API/developer-bridge/blob/master/packages/sdk-cli/src/auth/environments.json)):
  - `api.fitbit.com/oauth2/authorize?...client_id=22D2CP` returns HTTP 410 with the page "Fitbit Legacy Connection Retired ... The legacy Fitbit Web API and OAuth 2.0 connection flow were retired on October 30, 2026".
  - `api.fitbit.com/oauth2/token` returns HTTP 410: "The legacy Fitbit Web API and OAuth 2.0 endpoints were decommissioned on October 30, 2026".
  - `api.fitbit.com/1/user/-/developer-relay/hosts.json` returns a Google-style 401 UNAUTHENTICATED.
  - The relay URL answers 426 Upgrade Required, so it is still up.
  - gam.fitbit.com ("Fitbit Gallery App Manager") and gallery.fitbit.com return 200.
- Tooling freshness (npm registry and GitHub, checked 2026-11-07):
  - `@fitbit/sdk-cli`: latest 1.7.3; last publish 1.8.0-pre.11 on 2023-03-22.
  - `@fitbit/sdk`: latest 6.1.0; last publish 7.2.0-pre.0 on 2023-05-16.
  - `create-fitbit-app`: 1.0.1 (2020).
  - `Google-Health-API/developer-bridge`: last master commit 2023-03-22; only dependabot PRs since (latest 2026-06-24); not archived.
  - SDK deprecation policy: "We always plan to always support two SDK versions concurrently."
  - Sources: [npm @fitbit/sdk-cli](https://www.npmjs.com/package/@fitbit/sdk-cli), [npm @fitbit/sdk](https://www.npmjs.com/package/@fitbit/sdk), [GitHub developer-bridge](https://github.com/Google-Health-API/developer-bridge), [SDK Deprecation Policy](https://dev.fitbit.com/legal/deprecation-policy/)
- EU precedent: "we have made the decision to remove third-party apps and clocks from the Fitbit app gallery for users in the European Economic Area in June 2024 ... Users in other countries will not be impacted" (Google quote; 9to5Google, Ben Schoon, 2024-03-22). — [9to5Google](https://9to5google.com/2024/03/22/google-fitbit-apps-faces-eu-removal/)
- The old developer forum URLs (community.fitbit.com/t5/SDK-Development/...) now return 301 redirects to the generic [Google Health community](https://support.google.com/googlehealth/community). Search results show thread titles such as "GAM - Gallery management has ceased" (posted 2026-03-22 per a search snippet) and "Did Fitbit abandoned the Gallery App Manager" (2025-10-20), but their contents could not be read. — [search-result URL](https://community.fitbit.com/t5/SDK-Development/GAM-Gallery-management-has-ceased/m-p/5816460/highlight/true) (unverified)

### Inferences
- The CLI's only login path (authorize and token on api.fitbit.com) returns 410, and no updated CLI exists. A developer therefore almost certainly cannot log in to the Fitbit shell, so cannot install to a watch or the simulator over the developer bridge, in November 2026. This is inferred from the source code plus the endpoint responses; the CLI was not run.
- Even if login worked, Google says third-party installs and updates stop on November 28, 2026, three weeks from today. After that, a Fitbit OS gyro-streaming app could only keep running on a watch that already has it installed and is never reset.
- For a hackathon in late 2026, building on the Fitbit OS SDK is not a viable plan, and the cloud APIs offer no raw motion data (next section).

### Gaps
- No official statement says whether Google kept a private developer path, such as Google-account login to the CLI through a new endpoint. None was found.
- No official statement covers the developer relay or Gallery App Manager shutdown. Both URLs still answer, but whether they still work could not be tested without credentials.
- The forum threads about the Gallery review queue stopping in 2025-2026 could not be read (redirect), so that claim stays unverified.

## Do the Fitbit Web API or the Google Health API expose raw motion data, and what intraday data do they offer?

### Takeaway
No. Neither the legacy Fitbit Web API (now switched off) nor its replacement, the Google Health API, offers accelerometer, gyroscope or orientation data. The finest motion-derived data is steps, distance, floors, altitude and calories at 1-minute resolution; heart rate goes down to 1 second. The data arrives only after the device syncs.

### Cited Findings
- Fitbit Web API intraday endpoints exist for Active Zone Minutes, Activity, Breathing Rate, Heart Rate, HRV and SpO2. There is no accelerometer or gyroscope endpoint. — [Fitbit Web API Intraday](https://dev.fitbit.com/build/reference/web-api/intraday/)
- Activity intraday resources are calories, distance, elevation, floors, steps and swimming-strokes. "Intraday support can extend the detail-level response to include 1min, 5min and 15min for Activity." — [Get Activity Intraday by Date](https://dev.fitbit.com/build/reference/web-api/intraday/get-activity-intraday-by-date/)
- Heart rate: intraday support can extend the "detail-level response to include 1sec, 1min, 5min or 15min for Heart Rate." — [Get Heart Rate Intraday by Date](https://dev.fitbit.com/build/reference/web-api/intraday/get-heartrate-intraday-by-date/)
- Intraday access: "A Fitbit developer's personal Intraday data is automatically available through the 'Personal' application type." Access to other users' data through "Client" or "Server" apps "is granted on a case-by-case basis"; requests go through Issue Tracker. — [Fitbit Web API Intraday](https://dev.fitbit.com/build/reference/web-api/intraday/)
- Shutdown date CONFLICT: dev.fitbit.com banners say "On October 30, 2026, the Fitbit Web API will be turned off". Google's migration page (last updated 2026-10-28 UTC) and newsletter say "On November 2, 2026, the legacy Fitbit Web API and Fitbit OAuth endpoints will be turned off". The live endpoints (probed 2026-11-08 UTC) already return HTTP 410 citing October 30, 2026. Either way, the legacy API is off as of 2026-11-07. — [dev.fitbit.com Intraday](https://dev.fitbit.com/build/reference/web-api/intraday/); contradicted by [Google Health API migration guide](https://developers.google.com/health/migration) and [Google Health developer newsletters](https://developers.google.com/health/newsletters)
- Google Health API data types (44 listed): active-energy-burned, active-minutes, active-zone-minutes, activity-level, altitude, blood-glucose, body-fat, calories-in-heart-rate-zone, core-body-temperature, daily-heart-rate-variability, daily-heart-rate-zones, daily-oxygen-saturation, daily-respiratory-rate, daily-resting-heart-rate, daily-sleep-temperature-derivations, daily-vo2-max, distance, electrocardiogram, exercise, floors, food, food-measurement-unit, heart-rate, heart-rate-variability, height, hydration-log, irregular-rhythm-notification, menstrual-period, moods, nutrition-log, ovulation-test, oxygen-saturation, respiratory-rate-sleep-summary, run-vo2-max, sedentary-period, skin-temperature-sensors, sleep, steps, swim-lengths-data, symptoms, time-in-heart-rate-zone, total-calories, vo2-max, weight. None is an accelerometer, gyroscope, orientation or other IMU stream. — [Google Health API data types](https://developers.google.com/health/data-types)
- Resolutions and limits:
  - heart-rate: "Storage resolution: 1 second".
  - steps, distance, floors, altitude and calories: "1 minute".
  - Rollup `windowSize` "must be at least 1 second".
  - Rollup query ranges are capped at 14 days for heart-rate and a few others, and 90 days for the rest.
  - The only "raw sensor" type is temperature: "skin-temperature-sensors v4beta: Continuous minutely raw sensor measurements from dual-sensor hardware (Pixel Watch 4, Pixel Watch 5, and Fitbit Edge)".
  - Sources: [Google Health API data types](https://developers.google.com/health/data-types), [Vitals data types](https://developers.google.com/health/data-types/vitals)
- The Google Health API uses Google OAuth, with scopes prefixed `https://www.googleapis.com/auth/googlehealth`. Fitbit tokens cannot be carried over, so every user must consent again. — [Google Health API migration guide](https://developers.google.com/health/migration)

### Inferences
- A cloud API cannot give real-time or raw IMU data. It returns data only after the device syncs, at minute granularity for motion, so it is useless for gesture or tremor-style analysis.
- The legacy "Personal app" intraday route is moot, because the legacy API is off; new work must use the Google Health API.

### Gaps
- None material; the data-type list is explicit. Whether Google plans to add raw IMU data types was not found in any announcement.

## Alternatives: Pixel Watch / Wear OS, Galaxy Watch, Garmin Connect IQ

### Takeaway
Wear OS watches give the most direct raw access. This covers the Pixel Watch (which needs an Android 12+ phone) and the Galaxy Watch4 and later:
- They use the standard Android `SensorManager`, with `TYPE_ACCELEROMETER` (m/s^2) and `TYPE_GYROSCOPE` (rad/s).
- Rates go up to 200 Hz through `registerListener()`; anything faster needs the `HIGH_SAMPLING_RATE_SENSORS` permission.
- The app can stream straight to a server over Wi-Fi or LTE, or to an Android phone through the Data Layer API.
- Galaxy watches also offer Samsung's Health Sensor SDK, which provides low-power, continuous, raw 25 Hz accelerometer data, but public distribution of apps using it needs a Samsung partnership.

Garmin Connect IQ provides batched accelerometer (milli-g) and gyroscope (deg/s) data through `Sensor.registerSensorDataListener`:
- The gyroscope API is listed for 133 device entries.
- Typical rates are 25 Hz, with up to 100 Hz on supported devices since SDK 6.3.0 (August 2023).
- The documented route to the internet is BLE through the phone.

### Cited Findings
- Android (applies to Wear OS):
  - For apps targeting Android 12+, the system "places a limit on the refresh rate" of accelerometer, gyroscope and geomagnetic data.
  - With `registerListener()` "the sensor sampling rate is limited to 200 Hz"; with `SensorDirectChannel` it is limited to "RATE_NORMAL, which is usually about 50 Hz".
  - "If your app needs to gather motion sensor data at a higher rate, you must declare the HIGH_SAMPLING_RATE_SENSORS permission"; otherwise a SecurityException is thrown.
  - If the user turns off microphone access, motion sensors are "always rate-limited".
  - Source: [Android Sensors Overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview)
- Units: TYPE_ACCELEROMETER reports m/s2 and TYPE_GYROSCOPE reports rad/s; uncalibrated variants exist. — [Android Motion sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- Wear OS networking: "When a watch has a Bluetooth connection to a phone, the watch's network traffic is generally proxied through the phone. When a phone is unavailable, Wi-Fi and cellular networks are used"; "Don't use the Data Layer API to connect a Wear OS app to a network". For high bandwidth, request Wi-Fi through ConnectivityManager. — [Wear OS Network access](https://developer.android.com/training/wearables/data/network-access)
- Wear OS Data Layer (watch to phone): data items are "generally small", and Assets carry large binary objects. "If a Wear OS device is paired with an iOS device, the Data Layer API won't work." — [Wear OS Data Layer overview](https://developer.android.com/training/wearables/data/data-layer)
- Installing your own app: "Wear OS supports wireless debugging ... enable developer options and wireless debugging on the watch, pair your development computer using a pairing code"; USB works on watches that have a USB-capable cradle. — [Debug a Wear OS app](https://developer.android.com/training/wearables/get-started/debugging)
- Pixel Watch 5 runs "Wear OS 7.0" and "Works with most phones running on Android 12.0 or newer. Requires Google Account and Google Pixel Watch app." It has a gyroscope, accelerometer, magnetometer and barometer. — [Pixel Watch 5 specs](https://store.google.com/us/product/pixel_watch_5_specs?hl=en-US)
- Samsung Health Sensor SDK (sources: [overview](https://developer.samsung.com/health/sensor/overview.html), [FAQ](https://developer.samsung.com/health/sensor/faq.html)):
  - Overview: "compatible with Galaxy Watch4 series and later models"; "The accelerometer, ECG, and PPG data are provided as raw data"; accelerometer data is "Raw X, Y, and Z axis data". It works only on watches "running Wear OS powered by Samsung".
  - FAQ: the SDK's accelerometer "records data samples with 25Hz resolution continuously", collected "without waking up the CPU". The FAQ also notes "The Android sensor manager also provides accelerometer tracking".
  - There is no emulator support.
  - Developer mode "is intended only for testing"; distributing an app requires a Samsung partnership, or "the SDK will return a Policy Error".
- Garmin Connect IQ sensor API (source: [Connect IQ Toybox.Sensor](https://developer.garmin.com/connect-iq/api-docs/Toybox/Sensor.html)):
  - `Sensor.registerSensorDataListener(listener, options)` is used to "fetch high-frequency data from various sensors".
  - The `:period` option sets the batch length ("Maximum is 4 seconds"). `:accelerometer`, `:gyroscope` and `:magnetometer` each take `:enabled`, `:sampleRate` ("Samples per second to request in Hz") and `:includeTimestamps`; the accelerometer also offers `:includePower`, `:includePitch` and `:includeRoll`.
  - "Only one data request is allowed to be registered at a time", and the call "Will cause an app crash if called from a data field app".
  - `getMaxSampleRate()` and `getMaxSampleRateForSensorType()` report the limit at runtime; no number is documented on the page.
- Units and availability: AccelerometerData x/y/z are "in Milli G units" (since API 2.3.0), and GyroscopeData x/y/z are "in deg/sec units" (since API 3.3.0). The GyroscopeData supported-device list has 133 entries (AccelerometerData has 164), including fenix 5 Plus through fenix 9, epix, Enduro, Descent, D2, Approach, Forerunner 55/165/170/245/255/265/570/745/945/955/965/970, Instinct 2/3, Venu 2/3/4, vivoactive 6 and Edge bike computers. The page does not say every listed device has gyroscope hardware. — [AccelerometerData](https://developer.garmin.com/connect-iq/api-docs/Toybox/Sensor/AccelerometerData.html), [GyroscopeData](https://developer.garmin.com/connect-iq/api-docs/Toybox/Sensor/GyroscopeData.html)
- Connect IQ SDK 6.3.0 release (official Garmin post by Brad.ConnectIQ, 2023-08-30): "Add support for setting sampling frequency to 100hz for real-time accelerometer data"; "Gyroscope supports sampling rates up to 100hz, whereas magnetometer supports up to 50hz". The post does not list devices. — [Garmin forum announcement](https://forums.garmin.com/developer/connect-iq/b/news-announcements/posts/connect-iq-6-3-0-sdk-release)
- Forum reports: a developer got "max rate is 25 Hz" in the simulator for a fenix 7 Pro (2023-09-14). Garmin's Brad.ConnectIQ replied "It is just an issue with the simulator/device config files" and said it should work on the real device. A user later said fenix 6 watches got 100 Hz support in beta firmware. — [Garmin forum bug report](https://forums.garmin.com/developer/connect-iq/i/bug-reports/ciq-6-3-accelerometer-sim-rates) (forum)
- Connect IQ data path: the Communications module talks "with a mobile phone via Bluetooth Low Energy (BLE). The mobile phone may be sharing data with the device, or it may act as a bridge between the app and the Internet" (`makeWebRequest`, and `transmit` to a companion phone app). "The number of active requests running in parallel is limited". — [Connect IQ Toybox.Communications](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)

### Inferences
- The best replacement for a "Fitbit gyro" idea is a Pixel Watch, or a Galaxy Watch4 or later. Both are Fitbit/Google-ecosystem-adjacent and give raw gyroscope and accelerometer data at up to 200 Hz with ordinary Android code. They can stream over Wi-Fi straight to a laptop server (WebSocket or UDP), avoiding the Fitbit-style phone companion. Both need an Android phone for setup; the Pixel Watch needs Android 12+, and the Data Layer API does not work with iPhones.
- Samsung's SDK is the better choice for low-power, all-day 25 Hz accelerometer logging. For short, high-rate capture, plain SensorManager is simpler and needs no partnership.
- Garmin works for teams that already own a recent fenix, epix, Forerunner or Venu. Expect 25 Hz unless the device supports the 100 Hz mode, and expect a BLE-limited path through the phone. Check `getMaxSampleRateForSensorType` on the target device.

### Gaps
- Maximum hardware rates for the Pixel Watch and Galaxy Watch IMUs (with `HIGH_SAMPLING_RATE_SENSORS`) were not found in official specs.
- No official per-device table of Connect IQ 100 Hz support was found; only the SDK 6.3.0 post and forum reports.
- Real-world BLE throughput for Connect IQ `transmit`/`makeWebRequest` was not researched.
