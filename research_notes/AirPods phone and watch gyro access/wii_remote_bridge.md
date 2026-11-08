# Turning streamed motion-sensor data (AirPods, phone, watch) into a Wii-remote-style controller on Windows 11

## How does the Dolphin DSU client work (configuration, port 26760, protocol version, fields used, units, timestamps), and where is the cemuhook protocol documented?

### Takeaway
Dolphin's DSU client is a UDP client for the cemuhook "DSU" protocol, version 1001. Its default server is 127.0.0.1, port 26760. It reads the accelerometer in g and the gyroscope in degrees per second from a fixed 100-byte "controller data" packet, converts them to m/s² and rad/s internally, and never reads the packet's microsecond motion timestamp. The protocol is documented in the v1993/cemuhook-protocol README. Dolphin's own code says it was written using DS4Windows' `UdpServer.cs` as documentation. All Dolphin source below was read from `master` on 2026-11-07 (HEAD 257a6d0eac, committed 2026-11-07).

### Cited Findings
**Protocol documentation (v1993/cemuhook-protocol README; last commit 2023-02-04, "Add controller rumble")**
- Transport is UDP. "Cemuhook use server at `localhost:26760`". One server app should serve all of its sources rather than run several instances. Numbers are little endian. Only one protocol version is known: `1001`. — [cemuhook-protocol README](https://github.com/v1993/cemuhook-protocol) (rendered at [v1993.github.io/cemuhook-protocol](https://v1993.github.io/cemuhook-protocol/))
- 16-byte header:
  - offset 0: magic, `DSUS` from the server or `DSUC` from the client;
  - offset 4: u16 protocol version (1001);
  - offset 6: u16 length of the packet *without* the header;
  - offset 8: u32 CRC32 of the whole packet, computed with this field zeroed;
  - offset 12: u32 sender ID (stays the same for one run; may be random).
  - The u32 message type at offset 16 "is not actually part of header so it counts as length". — [cemuhook-protocol README](https://github.com/v1993/cemuhook-protocol)
- Message types: `0x100000` protocol version, `0x100001` information about connected controllers, `0x100002` actual controller data, plus the unofficial `0x110001` motor info and `0x110002` rumble. Replies use the same type value as the request. — [cemuhook-protocol README](https://github.com/v1993/cemuhook-protocol)
- Both the info reply and the data reply start with the same 11 bytes:
  - slot (0–3);
  - slot state: 0 not connected, 1 reserved, 2 connected;
  - device model: 0 n/a, 1 no or partial gyro, 2 full gyro;
  - connection type: 0 n/a, 1 USB, 2 Bluetooth;
  - 6-byte MAC address;
  - battery byte: 0x00 n/a … 0x05 full, 0xEE charging, 0xEF charged.
  - A slot with no controller can be answered with 12 zero bytes. — [cemuhook-protocol README](https://github.com/v1993/cemuhook-protocol)
- Subscribing to controller data: a `0x100002` request needs "no instant response". The server should "begin or continue sending data" for the requested controller. Because "there is no way to know when client is gone", the server must run its own timeout. Request flags: `1` slot-based registration, `2` MAC-based registration, `0` subscribe to all controllers. — [cemuhook-protocol README](https://github.com/v1993/cemuhook-protocol)
- Controller-data payload. Offsets are counted after the 20 bytes of header plus type:
  - 0–10: the shared beginning above;
  - 11: connected flag;
  - 12: u32 packet number;
  - 16–17: button bitmasks;
  - 18: HOME button;
  - 19: touch button;
  - 20–23: stick axes (Y is "plus upward");
  - 24–35: analog buttons;
  - 36–47: two 6-byte touch records;
  - **48: u64 "Motion data timestamp in microseconds, update only with accelerometer (but not gyro only) changes";**
  - **56, 60, 64: float accelerometer X, Y, Z;**
  - **68, 72, 76: float gyroscope pitch, yaw, roll.**
  - "Acceleration values are in g's (1 g ≈ 9.8 m/s²), gyroscope ones are in deg/s." — [cemuhook-protocol README](https://github.com/v1993/cemuhook-protocol)
  - So a full data packet is 20 + 80 = 100 bytes, and its length field is 84. (This is arithmetic from the table above.)
- Rumble (unofficial): clients should re-send the rumble state "twice to ten times per second". A server should set a motor to zero once rumble packets for it stop arriving. — [cemuhook-protocol README](https://github.com/v1993/cemuhook-protocol)

**Dolphin's implementation**
- `DualShockUDPProto.h`:
  - It says: "CemuHook DualShockUDP protocol implementation using UdpServer.cs from https://github.com/Ryochan7/DS4Windows as documentation".
  - It declares `CEMUHOOK_PROTOCOL_VERSION = 1001`, `PORT_COUNT = 4`, and the magic strings `DSUC`/`DSUS`.
  - Its packed `PadDataResponse` struct ends with the motion fields `u64 accelerometer_timestamp_us; float accelerometer_x_g, accelerometer_y_g, accelerometer_z_g; float gyro_pitch_deg_s, gyro_yaw_deg_s, gyro_roll_deg_s`.
  - Messages with a bad CRC32, or a protocol version above 1001, are rejected. — [Dolphin DualShockUDPProto.h](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerInterface/DualShockUDPClient/DualShockUDPProto.h)
- Defaults: `DEFAULT_SERVER_ADDRESS[] = "127.0.0.1"` and `DEFAULT_SERVER_PORT = 26760`. — [Dolphin DualShockUDPClient.h](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerInterface/DualShockUDPClient/DualShockUDPClient.h)
- Config keys:
  - They live in the `DualShockUDPClient` system config, section `Server`.
  - `Enabled` is a bool.
  - `Entries` is a string of `description:address:port;` records. Several servers are supported; an entry with fewer than 3 fields is skipped.
  - Older single-server keys `IPAddress` and `Port` also exist. — [Dolphin DualShockUDPClient.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerInterface/DualShockUDPClient/DualShockUDPClient.cpp)
- Timing:
  - Dolphin re-sends its pad-data subscription every 1 s (`SERVER_REREGISTER_INTERVAL`).
  - It asks for the port list every 1 s (`SERVER_LISTPORTS_INTERVAL`) and asks for 4 pads (`SERVER_ASKED_PADS = 4`).
  - It treats a server as gone after 1 s without a reply (`SERVER_UNRESPONSIVE_INTERVAL`). — [Dolphin DualShockUDPClient.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerInterface/DualShockUDPClient/DualShockUDPClient.cpp)
- Inputs each DSU device exposes:
  - Buttons and analog inputs: Cross, Circle, Square, Triangle, L1/R1/L2/R2, Share, Options, PS, Touch Button, Pad N/S/E/W. Sticks and touch are also exposed.
  - Six motion axes, each split into two directions:
    - `Accel Up/Down` (from accel Y), `Accel Left/Right` (from accel X), `Accel Forward/Backward` (from accel Z);
    - `Gyro Pitch Up/Down`, `Gyro Roll Left/Right`, `Gyro Yaw Left/Right`.
  - Code comments: "Convert Gs to meters per second squared" (scale by `GRAVITY_ACCELERATION`) and "Convert degrees per second to radians per second". — [Dolphin DualShockUDPClient.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerInterface/DualShockUDPClient/DualShockUDPClient.cpp)
- The timestamp is unused. The client source has zero matches for "timestamp", so `accelerometer_timestamp_us` is never read. The emulated Wii Remote steps its motion by its own fixed interval, `1.f / ::Wiimote::UPDATE_FREQ` with `UPDATE_FREQ = 200`. — [Dolphin DualShockUDPClient.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerInterface/DualShockUDPClient/DualShockUDPClient.cpp); [Dolphin Wiimote.h](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/Wiimote.h); [Dolphin WiimoteEmu.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/WiimoteEmu.cpp)
- Why bindings fill in automatically: the default desktop Wii Remote mapping binds the Motion Input accelerometer to `` `Accel Up` `` … `` `Accel Backward` `` and the gyroscope to `` `Gyro Pitch Up` `` … `` `Gyro Yaw Right` ``. These are exactly the input names of a DSU device. — [Dolphin WiimoteEmu.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/WiimoteEmu.cpp)
- Dolphin wiki (last edited 8 March 2026):
  - Dolphin has been a DSU client "Since 5.0-11083".
  - UI path: Controller Settings → Alternate Input Sources → DSU Client tab → Enable → Add (IP and port).
  - A working server appears as `DSUClient/x/xxxx` in the Devices drop-down. — [Dolphin Wiki: DSU Client](https://wiki.dolphin-emu.org/index.php?title=DSU_Client)
- Axis signs: the cemuhook README defines no axis-sign convention. PhoneGyro's author checked against real clients (PadTest and Cemu). Relative to a standard right-handed AHRS frame, the DSU output flips `RotY → −RotY`, `AccX → −AccX`, `AccZ → −AccZ`, and a controller at rest reports `AccY = −1 g`. — [PhoneGyro motion-pipeline doc](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/motion-pipeline.en.md)

### Inferences
- A minimal custom DSU server is small. It could be written in Python on the Windows PC and fed by a phone or AirPods relay. It has to:
  - listen on UDP 26760;
  - answer `0x100001` with one 32-byte packet per requested slot (16-byte header + 4-byte type + 12-byte slot record);
  - on `0x100002`, remember the client's address and keep streaming 100-byte data packets, each with a correct CRC32 (computed with the CRC field zeroed) and an incrementing packet number;
  - stop a few seconds after the last re-subscription. Dolphin re-subscribes every second.
- Fill the timestamp with a real microsecond clock even though Dolphin ignores it. Cemu-family clients integrate with it, according to PhoneGyro's notes on how Cemu behaves.
- Dolphin ignores the timestamp and steps motion at its own fixed rate. So send at a steady rate, ideally 60–100 Hz or more. Wi-Fi bursts and gaps will show up as pointer jitter.
- Use the sign convention from PhoneGyro's tested notes (Y-axis gravity of −1 g at rest, with flipped yaw/X/Z) as the starting point. Then check it in Dolphin's controller-config preview.

### Gaps
- No official axis-sign table exists for DSU. The convention above is one developer's empirical result (PhoneGyro), not a spec.
- I did not check whether Dolphin reads the slot's "model" byte (for example, whether model 1 vs 2 changes anything).

## Which existing apps act as DSU servers from a phone (iOS/Android) or from AirPods, and how are they set up?

### Takeaway
Several DSU servers work with phones:
- **PhoneGyro:** browser-based, with the PC running the server; iOS and Android; MIT; v2.1.1, October 2026.
- **PadForge:** a Windows app with a phone web controller and a built-in DSU server; v5.2.2, October 2026.
- **DSUController:** an iOS/Android app with ready-made Dolphin Wii Remote profiles.
- **AndroidDSU:** Android, MIT.
- **MotionSourceiOS:** sideloaded; last updated 2023.

No ready-made AirPods-to-DSU or Apple-Watch-to-DSU server was found. Today AirPods head tracking reaches a PC only through head-tracker apps that send to OpenTrack (SmoothTrack, HeadTrack), or through a Raspberry Pi Bluetooth bridge (pods-head-tracker). For a hackathon, the realistic AirPods path is a custom iPhone relay app.

### Cited Findings
**Dolphin's own list (wiki page "DSU Client", last edited 8 March 2026)**
- Setup: Controller Settings → Alternate Input Sources → DSU Client tab → tick Enable → Add → server IP and port.
- The server "usually defaults" to 127.0.0.1:26760, but "this might be completely different, for example, when using an Android device as motion source".
- A working server shows `DSUClient/x/xxxx` entries in the Devices drop-down. On Windows, the DSU Pad Test app can confirm the server is sending. — [Dolphin Wiki: DSU Client](https://wiki.dolphin-emu.org/index.php?title=DSU_Client)
- Servers the wiki lists:
  - Android: DSUController (motion and basic buttons), DSU Remote (motion and basic buttons, "also on GitHub"), and rajkosto's MotionSource (sideloaded, motion only).
  - iOS: DSUController and DSU Remote.
  - Windows: BetterJoy, DorsalVR (OpenXR), DS4Windows (Ryochan7 fork), OpenTrack DSU Server (experimental), PSMove-DSU, ScpToolkit (not recommended), SI2DSU, Steam Gyro for CemuHook, and WiimoteHook.
  - For real controllers the wiki prefers native motion input: SDL on Windows/macOS (since 5.0-16861) and evdev on Linux (since 5.0-11484). — [Dolphin Wiki: DSU Client](https://wiki.dolphin-emu.org/index.php?title=DSU_Client)

**PhoneGyro (formerly GyroBridge); MIT; latest v2.1.1 released 2026-10-12; last push 2026-11-03**
- "PhoneGyro turns your computer into a server and your iPhone or Android phone into a motion source." — [PhoneGyro README](https://github.com/MrHoustonOff/PhoneGyro)
- Setup, with no app on the phone:
  - Download `PhoneGyro.exe`. It is a single file, and a Windows-on-ARM build also exists.
  - Phone and PC must be "on the same Wi-Fi network". Scan the QR code.
  - iPhone/iPad: install a local certificate once, because "Safari only exposes gyroscope data over HTTPS".
  - Android: open the page in Chrome and accept the self-signed certificate warning. — [PhoneGyro README](https://github.com/MrHoustonOff/PhoneGyro)
- DSU port is `26760`. Tested on iOS 26 (iPhone 13 Pro, iPhone 15, iPad 9) and Android 11. Listed as compatible with Cemu, RPCS3, Ryujinx, Yuzu, Dolphin and PCSX2. — [PhoneGyro README](https://github.com/MrHoustonOff/PhoneGyro)
- GyroBridge v1.x is deprecated. The unsigned exe may be flagged by Defender's heuristics. — [PhoneGyro README](https://github.com/MrHoustonOff/PhoneGyro)
- Windows Firewall must allow PhoneGyro's inbound connections. If you dismiss the first prompt, "the phone will not connect and Windows will not ask again". — [PhoneGyro troubleshooting](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/troubleshooting.en.md)
- Pipeline:
  - On the phone, the browser's `devicemotion` event gives the gyro in °/s. Acceleration is taken as `accelerationIncludingGravity / 9.80665`, giving g. The `deviceorientation` quaternion is also sent.
  - The data travels phone → WSS (WebSocket over TLS) → PC → UDP 26760 → emulator.
  - On iOS Safari the `rotationRate` axes arrive permuted relative to the accelerometer axes, as "(devY, devZ, devX)". On Android they match.
  - The sign of gravity differs between iOS and Android, so the server learns the axis mapping in a calibration wizard. — [PhoneGyro motion-pipeline doc](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/motion-pipeline.en.md)
- Server behaviors worth copying:
  - "A data request is a subscription": stream from the device; do not reply to each request. "Cemu repeats its request after every packet it receives".
  - A new subscriber gets one rest packet immediately.
  - If the phone is silent for more than 250 ms, subscribers get zero-rate frames at 60 Hz (a heartbeat).
  - Timestamps always increase. — [PhoneGyro motion-pipeline doc](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/motion-pipeline.en.md)

**PadForge (free Windows remapper; latest v5.2.2, released 2026-10-29)**
- "Open a tab on your phone. That tab becomes a gamepad." — [PadForge README](https://github.com/hifihedgehog/PadForge)
- v4.3.0 (released 2026-08-20) added phone motion: "The page reads the handset's gyroscope and accelerometer and streams them to the slot. Browsers only hand out sensor data over a secure connection, so PadForge binds a self-signed certificate and serves over HTTPS, with a QR code on the Dashboard." — [PadForge README](https://github.com/hifihedgehog/PadForge)
- v5.0.0 (2026-10-04) added a plain-HTTP fallback behind a ten-character access code. — [PadForge README](https://github.com/hifihedgehog/PadForge)
- "The built-in DSU / Cemuhook server broadcasts gyroscope and accelerometer on UDP port 26760 so emulators can use real motion for Splatoon, Wii titles…". It serves slots 1–4 independently of each slot's virtual output type. — [PadForge README](https://github.com/hifihedgehog/PadForge)
- Head trackers: Sony head-tracking headphones (WH-1000XM5 family) are a confirmed motion source for the whole pipeline, including DSU. The README never mentions AirPods. — [PadForge README](https://github.com/hifihedgehog/PadForge)

**DSUController (breeze2; App Store app; guides repo last pushed 2026-03-20)**
- A mobile app "based on cemuhook-protocol to simulate some game controllers", for Cemu, Citra, Dolphin and Yuzu. — [DSUController Guides](https://github.com/breeze2/dsu-controller-guides)
- Dolphin setup:
  1. Controller Settings → Alternate Input Sources → Enable.
  2. Add the app's IP and port (shown on its settings page).
  3. Choose Emulated Wii Remote and set the Device to `DSUClient/1/`.
  4. Load the provided `DSUController.ini` profile from `Documents/Dolphin Emulator/Config/Profiles/Wiimote/`. — [DSUController Guides](https://github.com/breeze2/dsu-controller-guides)
- Use the portrait layout for a Wii Remote and landscape for a Switch Pro controller. Two phones can act as a Wii Remote plus Nunchuk. — [DSUController Guides](https://github.com/breeze2/dsu-controller-guides)
- If the device does not appear, use the same Wi-Fi and enable iOS "Local Network" access for the app. — [DSUController Guides](https://github.com/breeze2/dsu-controller-guides)
- Rumble needs an unmerged Dolphin PR (#11545, closed without merging 2023-03-03). — [DSUController Guides](https://github.com/breeze2/dsu-controller-guides)
- The profile maps the DSU `Accel Up…Backward` and `Gyro Pitch/Roll/Yaw` inputs to the Wii Remote's IMUAccelerometer/IMUGyroscope groups, and phone buttons to A/B/1/2/+/−/Home. — [DSUController.ini](https://github.com/breeze2/dsu-controller-guides/blob/main/configs/dolphin/DSUController.ini)

**Other phone servers**
- AndroidDSU (PlayXboxtion963; MIT; release 2.2 on 2025-06-08): a DSU server for Android 5.0+. It sends all DSU buttons plus the phone's gyroscope and accelerometer, and supports unofficial DSU rumble, volume-key buttons, two virtual sticks and adjustable sensitivity. Supported emulators: Cemu, Dolphin, Yuzu. — [AndroidDSU](https://github.com/PlayXboxtion963/AndroidDSU)
- MotionSourceiOS (shiftinv; LGPL-2.1; v1.1.0 on 2023-07-30, with no pushes since): a sideloaded .ipa (AltStore or Sideloadly). Setup: "enter the IP and port shown on your device" in the emulator. — [MotionSourceiOS](https://github.com/shiftinv/MotionSourceiOS)

**AirPods and Apple Watch**
- GitHub repository searches on 2026-11-07 for "airpods dsu", "airpods cemuhook", "headphone motion dsu", "apple watch dsu" and "watch cemuhook" returned no repositories. — [GitHub search](https://github.com/search?q=airpods+dsu&type=repositories)
- Kishimen (takanakahiko; MIT; last push 2020-12-12): "an application that sends AirPods Pro data acquired by CMHeadphoneMotionManager to any address and port via UDP" (an iOS app plus a Node `server.js`). It is a starting point for a relay, not a DSU server. — [Kishimen](https://github.com/takanakahiko/Kishimen)
- MotionLink (Maker Portal LLC, App Store) records AirPods head yaw/pitch/roll to CSV for research. It mentions no UDP, DSU or PC streaming. — [MotionLink on the App Store](https://apps.apple.com/us/app/motionlink/id6759984595)
- AirPods → OpenTrack options (from search summaries of the listings; I did not open these pages):
  - SmoothTrack's AirPods Pro mode uses the headphones' 3DOF head direction and sends it to OpenTrack over UDP.
  - HeadTrack (Steam listing) accepts AirPods/Beats input on iOS/macOS and sends it to OpenTrack.
  — [SmoothTrack](https://apps.apple.com/us/app/smoothtrack/id1528839485); [HeadTrack on Steam](https://store.steampowered.com/app/4214760)
- pods-head-tracker (GPL-3.0; v0.5.5, 2026-08-20): "Turn AirPods into a head tracker for OpenTrack, using a small Raspberry Pi as the Bluetooth bridge". — [pods-head-tracker](https://github.com/batubozkan/pods-head-tracker)

### Inferences
- **Fastest hackathon wiring for a phone:**
  1. Run PhoneGyro or PadForge on the Windows PC and open the QR-code page on the phone.
  2. In Dolphin's DSU Client tab, add `127.0.0.1:26760` (the server runs on the PC).
  3. Pick the `DSUClient/…` device for the Wii Remote.
  4. Tune Motion Input → Point (Total Yaw) and bind Recenter.
- **Phone-as-server apps** (DSUController, AndroidDSU, MotionSourceiOS): enter the phone's LAN IP (not 127.0.0.1) and its port in Dolphin.
- **AirPods**, two options:
  - An iPhone app reads `CMHeadphoneMotionManager` and relays the data (UDP or WebSocket) to a PC process that speaks DSU on 26760. Kishimen shows the relay half.
  - Or chain SmoothTrack/HeadTrack → OpenTrack → the wiki's experimental "OpenTrack DSU Server".
  - AirPods measure head motion, so they suit pointing and tilting (looking), not Wii-style arm swings.

### Gaps
- I could not check "DSU Remote". Dolphin's wiki lists it for Android and iOS, and a BlueStacks listing names Marco Dijkslag as the developer, but neither its store page nor its GitHub repo was opened.
- I could not locate the "OpenTrack DSU Server" project. GitHub repository search for "opentrack dsu" and "opentrack cemuhook" returned nothing (the search API may have been rate-limited by then).
- I found no Apple Watch DSU server. A watch would need a WatchConnectivity relay through the iPhone; other notes cover watch sensor access.

## How does Dolphin turn gyroscope and accelerometer data into an emulated Wii Remote pointer (IMU IR, Point recenter) and into swings and shakes?

### Takeaway
The pointer lives on the Wii Remote's "Motion Input" tab:
- Dolphin integrates the gyroscope into an orientation (a quaternion, a 4-number rotation).
- It corrects pitch and roll drift by blending in a small share of the accelerometer, which is a complementary filter (default 2%).
- It clamps yaw to "Total Yaw" (default 25°).
- It projects the result through the emulated IR camera's field of view to place the pointer.
- A "Recenter" input zeroes yaw and re-zeroes pitch.

Real swings and shakes need no detection. The DSU accelerometer goes straight into the emulated Wii Remote's accelerometer, and the gyroscope into the emulated MotionPlus. The button-driven Swing, Shake and Tilt groups are only for setups without a real sensor.

### Cited Findings
- **Point group settings.** The Motion Input "Point" group (`IMUCursor`, config name `IMUIR`) has one input, `Recenter`, and two settings:
  - **Total Yaw:** default 25°, range 0–360, "Clamping of rotation about the yaw axis". A code comment says the defaults were "chosen to reach screen edges in most games including the Wii Menu".
  - **Accelerometer Influence:** default 2%, range 0–100. Help text: "Influence of accelerometer data on pitch and roll. Higher values will reduce drift at the cost of noise. Consider values between 1% and 3%".
  - The group is on by default on desktop. It is off by default on Android, because there "touch controls generally work better". — [Dolphin IMUCursor.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerEmu/ControlGroup/IMUCursor.cpp)
- **Field of view.** The same group has **Horizontal FOV** and **Vertical FOV** settings. They default to the emulated IR camera's field of view, range 0.01–180°, with the help text "Camera field of view (affects sensitivity of pointing)". — [Dolphin WiimoteEmu.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/WiimoteEmu.cpp)
- **The `EmulateIMUCursor` algorithm**, step by step:
  1. If pointing is off or there is no gyro data, reset the state.
  2. Multiply the stored rotation by the rotation from `gyro × −1 × time_elapsed`.
  3. If the accelerometer reading is non-zero, apply `ComplementaryFilter(rotation, accel, accel_weight)`. This turns the gyro-estimated "up" vector toward the measured gravity direction by `acos(cos_angle) × accel_weight`.
  4. Clamp yaw to ±Total Yaw/2.
  5. While Recenter is held, store the current pitch as `recentered_pitch` and set the target yaw to 0.
  6. Renormalize the quaternion.
  — [Dolphin Dynamics.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/Dynamics.cpp)
- **Recenter.** The final pointing transform multiplies the IMU rotation by `RotateX(recentered_pitch)`, so Recenter re-zeroes both yaw and the current pitch. — [Dolphin WiimoteEmu.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/WiimoteEmu.cpp)
- **Raw data path.**
  - `GetTotalAcceleration()` takes the Motion Input accelerometer state (default `(0, 0, g)` if nothing is bound) and adds the simulated Swing and Shake accelerations.
  - `GetTotalAngularVelocity()` takes the Motion Input gyroscope and adds the simulated Tilt, Swing and Point angular velocity.
  - The results feed the emulated accelerometer report (`ConvertAccelData(GetTotalAcceleration(), …)`) and MotionPlus (`MotionPlus::GetGyroscopeData(GetTotalAngularVelocity())`). — [Dolphin WiimoteEmu.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/WiimoteEmu.cpp)
- **Gyroscope settings on the Motion Input tab:**
  - **Dead Zone:** default 2 °/s, range 0–180, "Angular velocity to ignore and remap".
  - **Calibration Period:** default 3 s, range 0–30, "Time period of stable input to trigger calibration. (zero to disable)".
  - Calibration restarts if any axis moves away from the running average by more than the dead zone, or if the calibration update rate is below 25 Hz (`WORST_ACCEPTABLE_CALIBRATION_UPDATE_FREQUENCY = 25`). — [Dolphin IMUGyroscope.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerEmu/ControlGroup/IMUGyroscope.cpp)
- **Wiki notes** (last edited 8 March 2026):
  - With correct motion bindings, the IR pointer comes from the motion sensors, so no sensor bar is needed.
  - Assign a button to recenter.
  - If the pointer cannot reach the screen edges, "Increasing 'Total Yaw' on the Motion Input tab of Emulated Wii Remotes should fix that".
  - Since 5.0-11205 the motion-derived pointer can be turned off, so IR can be mapped on "Motion Simulation" instead.
  - Since 5.0-11478 an "Extension Motion Input" tab appears when a Nunchuk is attached. — [Dolphin Wiki: DSU Client](https://wiki.dolphin-emu.org/index.php?title=DSU_Client)
- **Known drift issue #12077** ("DSU Client: Emulated Pointer Moves Up and Down After Continued Play"):
  - Opened 2020-04-26 on build 5.0-11898. With the pointer driven by gyro (Steam Gyro for CemuHook; also BetterJoy with Joy-Cons), it bobbed after about 10 minutes and "gets worse the longer you play".
  - Recenter did not fix it; toggling the DSU client fixed it temporarily.
  - Marked Fixed with "no response". A 2025 Steam Deck gyro stutter report (#13465) was closed as its duplicate. — [Dolphin issue 12077](https://bugs.dolphin-emu.org/issues/12077)
- **Button-driven "Motion Simulation" groups**, used when there is no real sensor. Defaults:
  - **Point (`Cursor`):** Vertical Offset 10 cm, Total Yaw 25°, Total Pitch 20°, Relative Input and Auto-Hide toggles; inputs Hide, Recenter and Relative Input Hold.
  - **Swing (`Force`):** Distance 50 cm, Speed 16 m/s, Return Speed 2 m/s, Angle 90°.
  - **Shake:** X/Y/Z inputs, Intensity (cm), Frequency 6 Hz (range 1–20).
  - **Tilt:** Angle 85° (range 0–180), Velocity 7 turns/s.
  — [Dolphin Cursor.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerEmu/ControlGroup/Cursor.cpp); [Dolphin Force.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerEmu/ControlGroup/Force.cpp); [Dolphin Tilt.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerEmu/ControlGroup/Tilt.cpp)
- **Default desktop mapping (Windows branch).** The Motion Simulation Point is bound to the mouse: `Cursor Y-`, `Cursor Y+`, `Cursor X-`, `Cursor X+`. A is `Click 0`, B is `Click 1`, and Shake is `Click 2` (`Middle Click` on macOS). — [Dolphin WiimoteEmu.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/WiimoteEmu.cpp)

### Inferences
- **Swings.** With a DSU source, detecting a swing is the game's job. A phone swung like a Wii Remote produces real accelerometer spikes, and the game reads them directly. Only when the source cannot be swung (AirPods head motion) or has no accelerometer would you detect a gesture yourself and bind it to the Motion Simulation "Swing" or "Shake" inputs.
- **Mouse-driven pointer.** Because the default Point is bound to the mouse cursor and Shake to the middle click, a script that moves the Windows cursor (SendInput) can drive the Wii pointer with no DSU at all. The trade-off is that the game then gets no real accelerometer or gyro data.
- **Sensitivity.** Total Yaw and the FOV settings control pointer sensitivity. A smaller Total Yaw means less wrist rotation crosses the screen. For AirPods head pointing, a small Total Yaw (around 15–25°) probably fits comfortable head turns. This is untested.
- **Yaw drift.** Gravity cannot correct yaw, so yaw drift builds up. Dolphin's answer is the yaw clamp plus Recenter. Bind Recenter to an easy phone button or gesture, and expect to press it now and then (see issue #12077).

### Gaps
- I did not measure how fast Dolphin's pointer drifts with phone-grade gyros, or whether the 25 Hz calibration-rate check misbehaves with slow sources such as AirPods. The check counts calls to the calibration update, and I did not confirm whether that tracks the DSU packet rate or the emulation polling rate.
- Shake Intensity's default is defined through a scale constant (`10 * default_intensity_scale`) whose value I did not resolve.

## On Windows 11 in 2026, what are the supported ways to create a virtual controller or move the mouse from a script?

### Takeaway
As of November 2026 there are five routes:
- **ViGEmBus:** archived since 2023-11-02 (final v1.22.0), but existing installs keep working. Python's `vgamepad` (v0.2.0, 2026-10-27) still bundles and auto-installs ViGEmBus 1.17.333, so it remains the quickest scripted Xbox 360/DualShock 4 pad.
- **HIDMaestro:** a user-mode driver with no kernel component and a .NET SDK (v2.1.0, Oct 2026). PadForge, which builds on it, is the GUI route.
- **VIIPER:** works through USBIP; needs the signed usbip-win2 driver; offers a TCP API with npm, NuGet, Rust and C++ clients (v0.9.0, Oct 2026).
- **vJoy:** the Brunner fork is signed for Windows 10/11 but barely maintained.
- **SendInput:** the standard way to move the mouse. pynput uses it. Microsoft's `InputInjector` (which can also inject gamepad input) needs a restricted capability declared in an app package manifest.

For Dolphin specifically, a virtual pad is often unnecessary: use DSU for motion, or mouse injection for the pointer.

### Cited Findings
**ViGEmBus status**
- The repository is archived. The last push and the final release, v1.22.0, are both dated 2023-11-02. — [nefarius/ViGEmBus](https://github.com/nefarius/ViGEmBus)
- End-of-life statement:
  - "In May 2023 a conflict with a registered trademark by ViGEM GmbH was discovered, leading to a mutual agreement". The project "will no longer receive any updates and has been archived/retired".
  - "This has no impact on existing installations except for the updater components". The old updaters "will continue to contact the old domain, which could lead to your public IP address getting leaked".
  - Affected: ViGEmBus v1.21.442 or older (Windows 10/11), v1.16.116 or older (Windows 7/8/8.1), HidHide v1.2.128 or older and BthPS3 v1.2.4 or older.
  - Fix: run the Legacinator tool, or edit `ViGEmBus_Updater.ini`/`HidHide_Updater.ini` to point at `https://aiu.api.nefarius.systems/...`.
  - The `vigem.org` domain transfer ran from 21 to 26 December 2023.
  - The page names no successor product. It says only that "the actively maintained ones will continue being supported, but now under the Nefarius brand name". — [Nefarius: ViGEm End of Life](https://docs.nefarius.at/projects/ViGEm/End-of-Life/)
- HidHide (the device "firewall" that hides real pads from games) is still maintained: last push 2026-07-05, latest release v1.5.230.0 (2024-05-11). — [nefarius/HidHide](https://github.com/nefarius/HidHide)

**vgamepad (Python; MIT; v0.2.0 released 2026-10-27)**
- "On Windows, `vgamepad` uses the Virtual Gamepad Emulation C++ framework". "The ViGEmBus driver (`v1.17.333`) is bundled with the library and installs automatically". `pip install vgamepad` "automatically runs the installer of the ViGEmBus driver". — [vgamepad README](https://github.com/yannbouteiller/vgamepad)
- It provides `VX360Gamepad` and `VDS4Gamepad`. On Linux it creates a `uinput` device. — [vgamepad README](https://github.com/yannbouteiller/vgamepad)
- Since v0.2.0 the DS4 extended report covers the touchpad, accelerometer and gyroscope: `gamepad.accelerometer(x_value=…)` and `gamepad.gyroscope(…)` take values between −32768 and 32767. — [vgamepad README](https://github.com/yannbouteiller/vgamepad); [vgamepad v0.2.0 release](https://github.com/yannbouteiller/vgamepad/releases/tag/v0.2.0)
- On the 2023 end-of-life issue (#19), the maintainer wrote: "Nefarius has been talking about a successor for ViGEm being developed in the background for a while, we'll see where this goes". — [vgamepad issue #19](https://github.com/yannbouteiller/vgamepad/issues/19)

**HIDMaestro and PadForge (2026)**
- HIDMaestro (v2.1.0, released 2026-10-27; last push 2026-11-06):
  - "Virtual game controllers, keyboards and mice that look like real hardware to Windows. No kernel driver. No network. No reboot."
  - "It runs entirely in user mode (UMDF2), signed with a locally trusted self-signed certificate. No EV certificate, no `testsigning` boot mode".
  - It offers 337 device profiles. The repo description says the devices are visible to "DirectInput, XInput, SDL3, browser Gamepad, WGI/GameInput".
  - The SDK is a .NET assembly (`HIDMaestro.Core.dll`, NativeAOT-capable) for x64 and ARM64. The self-contained test app needs administrator rights for its first-run certificate and driver install. — [HIDMaestro](https://github.com/hifihedgehog/HIDMaestro)
- PadForge (v5.2.2, 2026-10-29) is a free app "Built on HelixToolkit, HidHide, HIDMaestro, … .NET 10, … SDL3". It runs up to 16 virtual controllers, and a Keyboard + Mouse slot "can now type and point through a virtual keyboard and mouse". The gyro pipeline includes gyro-to-mouse and a DSU server. — [PadForge README](https://github.com/hifihedgehog/PadForge)

**VIIPER (GPL-3.0, with MIT client libraries; v0.9.0 released 2026-10-10)**
- "VIIPER lets developers create and programmatically control virtual USB input devices (using USBIP under the hood)". It "Runs on Linux and Windows"; on Windows, "usbip-win2 provides a signed kernel mode driver". — [VIIPER](https://github.com/Alia5/VIIPER)
- Emulated devices: Xbox 360 controller, DualShock 4, HID keyboard and HID mouse. — [VIIPER](https://github.com/Alia5/VIIPER)
- It exposes "a lightweight TCP-API", with client libraries on npm (`viiperclient`), NuGet (`Viiper.Client`), crates.io (`viiper-client`) and a header-only C++ library. — [VIIPER](https://github.com/Alia5/VIIPER)

**vJoy**
- The BrunnerInnovation fork (MIT; v2.2.2.0 released 2023-12-19; last push 2024-06-07) exists because Windows 11 users "couldn't use those features though, because of driver signing requirements", so Brunner sponsored the signing. Brunner "does **not** intend to spend a lot of resources maintaining and improving this project". "Only Windows 10 and Windows 11 are supported." — [BrunnerInnovation/vJoy](https://github.com/BrunnerInnovation/vJoy)
- Older forks: njz3/vJoy (latest release v2.2.1.1, 2020) and jshafer817/vJoy (v2.1.9.1, 2019). — [njz3/vJoy](https://github.com/njz3/vJoy); [jshafer817/vJoy](https://github.com/jshafer817/vJoy)

**Mouse and keyboard injection**
- `SendInput` "Synthesizes keystrokes, mouse motions, and button clicks". "This function is subject to UIPI. Applications are permitted to inject input only into applications that are at an equal or lesser integrity level". When UIPI blocks it, "neither GetLastError nor the return value will indicate the failure was caused by UIPI blocking". — [Microsoft Learn: SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
- `MOUSEINPUT` coordinates:
  - With `MOUSEEVENTF_ABSOLUTE`, "dx and dy contain normalized absolute coordinates between 0 and 65,535", mapped to the primary monitor, or to the whole virtual desktop with `MOUSEEVENTF_VIRTUALDESK`.
  - Without it, motion is relative. "Relative mouse motion is subject to the effects of the mouse speed and the two-mouse threshold values", which can multiply movement "by up to four times".
  - `MOUSEEVENTF_MOVE_NOCOALESCE` stops `WM_MOUSEMOVE` messages from being merged. — [Microsoft Learn: MOUSEINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput)
- pynput on Windows calls `windll.user32.SendInput` for moves and clicks, and `SetCursorPos` for setting the position. — [pynput win32 util](https://github.com/moses-palmer/pynput/blob/master/lib/pynput/_util/win32.py); [pynput mouse _win32](https://github.com/moses-palmer/pynput/blob/master/lib/pynput/mouse/_win32.py)
- `InputInjector` (Windows.UI.Input.Preview.Injection):
  - It can inject keyboard, mouse, touch, pen, gamepad and shortcut input. `InitializeGamepadInjection`, `InjectGamepadInput` and `UninitializeGamepadInjection` were added in Windows 10 1709 (SDK 16299).
  - "The APIs in this namespace require the inputInjectionBrokered restricted capability", declared as `<rescap:Capability Name="inputInjectionBrokered" />` in Package.appxmanifest. — [Microsoft Learn: InputInjector](https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.preview.injection.inputinjector)

**Option (d): no injection — a custom browser or Unity game reads the stream directly**
- Browser rules: `DeviceMotionEvent.requestPermission()` "requires transient activation, meaning that it must be triggered by a UI event such as a button click". It resolves to "granted" or "denied". The feature "is available only in secure contexts (HTTPS)". MDN page last modified 2026-08-04. — [MDN: DeviceMotionEvent.requestPermission()](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static)
- Unity: NativeWebSocket is a "WebSocket client for Unity/MonoGame/Godot Mono - with no external dependencies (WebGL, Native, Android, iOS, UWP)" (1,746 stars; last push 2026-10-26). — [endel/NativeWebSocket](https://github.com/endel/NativeWebSocket)
- Prior art for a phone-as-Wii-remote web game: web-riimote (MIT; archived; 2018; 479 stars). It turns "your smartphone into a 3D controller with a web app". The phone page uses the DeviceOrientation API, and a Node/Koa/Socket.io server relays the controller's messages to the display client. — [konaraddi/web-riimote](https://github.com/konaraddi/web-riimote)

### Inferences
- **Dolphin with real motion:** prefer DSU. No virtual pad or driver is needed. **Dolphin with pointer only:** a Python script that moves the cursor with SendInput absolute coordinates works with Dolphin's default Point mapping.
- **Other PC games:** `vgamepad` (Xbox 360 or DS4) is the lowest-effort scripted pad in 2026, despite ViGEmBus's retirement.
  - Caveat: the ViGEmBus 1.17.333 it installs falls in the "v1.21.442 or older" range that the end-of-life page flags for the updater IP leak. Run Legacinator, or fix the updater .ini, after installing.
  - Prefer HIDMaestro (.NET) or VIIPER (any language over TCP) for new work that should not depend on a retired driver.
- **vJoy** shows up as a generic joystick. Games that only read XInput will probably ignore it. This is not verified here.
- **UIPI:** if Dolphin or the game runs as administrator, a non-elevated injector script will fail silently.
- **Relative mouse motion:** "Enhance pointer precision" (mouse speed and thresholds) distorts relative SendInput moves. For gyro pointers, compute absolute positions, or turn acceleration off.
- **Unpackaged scripts:** InputInjector is probably impractical for a Python script, because it requires a packaged app with a restricted capability.
- **Custom game:** a browser game on the PC can open a WebSocket to a local relay on localhost. The phone page must be served over HTTPS (or use PadForge/PhoneGyro-style self-signed certificates) and ask for motion permission on a button tap.

### Gaps
- The InputInjector page does not say which input APIs see an injected gamepad (Windows.Gaming.Input only, or also XInput), or whether unpackaged desktop apps can use it. I did not verify either.
- I did not verify whether a vgamepad/ViGEm virtual DS4 with motion data is read as a motion device by Dolphin's SDL backend.
- I found no announcement of a Nefarius "VirtualPad" successor with dates or licensing. The end-of-life page names none.

## What simple algorithms do hobby/hackathon projects use (swing detection, tilt mapping, pointer smoothing, drift correction), and what latency is acceptable?

### Takeaway
The proven recipe:
1. Calibrate gyro bias by averaging while the device is still.
2. Move the pointer by angular rate × sensitivity × time step.
3. Correct only pitch and roll with gravity, using a complementary filter with a 1–3% accelerometer weight (Dolphin) or Madgwick (default gain 0.033 for a 6-axis IMU).
4. Give yaw a recenter button.
5. Use a tiny soft deadband and smooth only small movements. Never low-pass the gyro itself, because that adds lag.

For shakes and swings, use thresholds on acceleration changes with a cooldown. shake.js uses a jump of 15 m/s² on two axes and 1 s between events.

Latency targets: about 50 ms end to end is where delays start to go unnoticed for most people (some people detect less than 40 ms). Around 70–130 ms has been reported as workable for casual motion games.

### Cited Findings
**Drift and sensor fusion**
- Gyro error: "Standard gyroscopes provide raw rotational data without any filtering or correction for noise and drift (bias)… You usually determine the drift (bias) and noise by monitoring other sensors, such as the gravity sensor or accelerometer". Android's gyroscope reports rad/s. — [Android Developers: Motion sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- Gravity isolation:
  - A low-pass filter isolates gravity with `gravity = alpha*gravity + (1-alpha)*accel`, where `alpha = 0.8` in the example, "calculated as t / (t + dT)".
  - Subtracting gravity gives linear acceleration.
  - The time constant t "is a rough representation of the latency that the filter adds".
  - The `TYPE_LINEAR_ACCELERATION` sensor (acceleration minus gravity) can be used "to perform gesture detection". — [Android Developers: Motion sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- Gravity correction (JibbSmart, "Finding Gravity with Sensor Fusion", Gyro Wiki, 26 Jul 2021):
  - Rotate the previous gravity vector by the inverse gyro rotation, then nudge it toward the negated accelerometer reading by a fixed 0.02 per update. This is frame-rate dependent: "the error correction rate is tied to the update rate".
  - The improved version scales correction by "shakiness" with these constants: SmoothingHalfTime 0.25, ShakinessMin/Max 0.01/0.4, CorrectionStillRate 1, CorrectionShakyRate 0.1, CorrectionGyroFactor 0.1, CorrectionGyroMin/Max 0.05/0.25, CorrectionMinimumSpeed 0.01. Accelerometer units are g and gyro units are deg/s; multiply by 9.8 if your platform gives m/s². — [Gyro Wiki: Finding Gravity with Sensor Fusion](http://gyrowiki.jibbsmart.com/blog:finding-gravity-with-sensor-fusion)
- Madgwick (ahrs library docs):
  - Default gain is "0.033 for IMU implementations, or to 0.041 for MARG implementations", and the default rate is 100 Hz.
  - Beta is √(3/4) times the mean gyro error.
  - "the accelerometer computes the roll and pitch orientations only", so heading needs a magnetometer. — [ahrs: Madgwick Orientation Filter](https://ahrs.readthedocs.io/en/stable/filters/madgwick.html)
- Dolphin uses the complementary-filter approach, with an Accelerometer Influence default of 2% and advice to "Consider values between 1% and 3%". — [Dolphin IMUCursor.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerEmu/ControlGroup/IMUCursor.cpp)
- Dolphin's tilt-from-accelerometer function `GetRotationFromAcceleration` takes the angle `acos(dot(normalized_accel, (0,0,1)))` about the axis `cross(normalized_accel, (0,0,1))`. — [Dolphin Dynamics.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/WiimoteEmu/Dynamics.cpp)
- PhoneGyro's drift notes:
  - "DSU clients integrate the gyro themselves. At 60 Hz, fast 'waggling' motion accumulates 8–16° of error in a minute. Gravity later fixes the tilt, but nothing fixes yaw."
  - Its fix is an "attitude anchor". It compares the client's integrated estimate to the phone OS quaternion and adds a correction of `2·e` rad/s, capped at 20°/s.
  - In simulation, 60 s of fast motion with a 3% scale error gave 34.5° of drift without the correction and 0.1° with it.
  - Its internal 3D view uses Madgwick with β = 0.1. — [PhoneGyro motion-pipeline doc](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/motion-pipeline.en.md)

**Pointer mapping and smoothing**
- Core mapping (JibbSmart, "Good Gyro Controls Part 1: The Gyro is a Mouse", Gyro Wiki, 23 May 2019):
  - `Camera.Yaw += calibratedGyro.Yaw * gyroSensitivity * deltaTime` (pitch likewise).
  - Calibrate by averaging while the controller is still, and let players recalibrate any time.
  - Auto-calibration must be optional, because it "can misread slow, intentional movement".
- Sensitivity and acceleration (same post):
  - For a 2D cursor, sensitivity 1 means one full turn = one screen width; 8 (≈45°) or 16 (≈22.5°) are practical.
  - Acceleration example: sensitivity 1 → 2 between 0 and 75 deg/s.
- Smoothing and the gyro button (same post):
  - Tiered smoothing applies only to small inputs (example threshold 5 deg/s, with the lower threshold at half), because smoothing delays response.
  - "Tightening" scales slow input toward zero (example 5 deg/s) rather than using a hard cutoff.
  - A dedicated button turns the gyro off and on, like lifting a mouse off the desk. — [Gyro Wiki: The Gyro is a Mouse](http://gyrowiki.jibbsmart.com/blog:good-gyro-controls-part-1:the-gyro-is-a-mouse)
- PhoneGyro filters:
  - A soft-knee deadband, `scale = (|ω| − db)/|ω|`.
  - An accelerometer EMA (exponential moving average) with α = 0.04 at rest and 0.35 in motion.
  - "No gyro smoothing (1-Euro was removed). Any low-pass filter on angular rate adds delay, and the client integrates it into an overshoot." — [PhoneGyro motion-pipeline doc](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/motion-pipeline.en.md)
- PhoneGyro tremor-threshold guide: 0.10 °/s is the phone default; 0.20–0.35 °/s if the aim jitters while held still; 0.50 °/s for an MPU-6050 USB controller; 0.75–1.00 °/s for strong tremor. "take the lowest threshold at which the aim stays put when you hold still". — [PhoneGyro troubleshooting](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/troubleshooting.en.md)
- Dolphin's gyro defaults are a 2 °/s dead zone and a 3 s stillness auto-calibration. — [Dolphin IMUGyroscope.cpp](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/InputCommon/ControllerEmu/ControlGroup/IMUGyroscope.cpp)

**Shake and swing detection**
- shake.js (1,505 stars; last push 2018-10-17): defaults `threshold: 15` ("default velocity threshold for shake to register") and `timeout: 1000` ("default interval between events"). It fires when the change between consecutive `devicemotion` samples exceeds the threshold on at least two axes, and no more than once per timeout. — [alexgibson/shake.js](https://github.com/alexgibson/shake.js)
- "Shakiness" in the Gyro Wiki post is the biggest recent gap between the raw and the smoothed accelerometer reading, with thresholds of 0.01 (still) and 0.4 g (shaky). It is a ready-made, frame-rate-independent shake signal. — [Gyro Wiki: Finding Gravity with Sensor Fusion](http://gyrowiki.jibbsmart.com/blog:finding-gravity-with-sensor-fusion)

**Latency**
- Raaen, Eg and Griwodz, "Can gamers detect cloud delay?" (IEEE NetGames 2014, DOI 10.1109/NetGames.2014.7008962). Participants adjusted the delay between a button press and a simple visual.
  - "At the most sensitive, our findings reveal that some perceive delays below 40 ms. However, the median threshold suggests that motor-visual delays are more likely than not to go undetected below 51-90 ms."
  - "a large proportion of our participants can easily perceive delays shorter than 100 ms", and "for one out of every four trials, our participants could even detect delays below 40 ms". — [Raaen et al. 2014 (PDF)](https://cms.simula.no/sites/default/files/publications/files/paper_5.pdf); [dblp record](https://dblp1.uni-trier.de/rec/bibtex/conf/netgames/RaaenEG14)
- Santos, "Cross-Device Motion Interaction via Apple's Native System Frameworks" (arXiv:2508.01110, submitted 1 Aug 2025). An iPhone motion controller using CoreMotion and MultipeerConnectivity sent data "at 10 Hz" and measured "a mean delay of 70.4 ms" with the "95th percentile below 74 ms" on "typical 5 GHz Wi-Fi (-55 dBm RSSI)", with "zero packet loss" during a public demo with 21 participants. — [arXiv:2508.01110](https://arxiv.org/abs/2508.01110)
- Digital Foundry (via Engadget, 18 Mar 2010) estimated PlayStation Move end-to-end latency at about 133 ms (≈8 frames), display included. It called this "fine for most of the applications you would want from such a controller". The method was rudimentary (filming and counting frames). — [Engadget: PlayStation Move input latency analyzed by Digital Foundry](https://www.engadget.com/2010-03-18-playstation-move-input-latency-analyzed-by-digital-foundry.html)
- Pipeline facts that set the latency floor:
  - Dolphin's emulated Wii Remote updates at 200 Hz (5 ms steps). — [Dolphin Wiimote.h](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/Wiimote.h)
  - PhoneGyro holds frames while the WebSocket is busy, but keeps the rotation by sending the averaged rate. It drops the backlog after 0.85 s and counts OS gaps of more than 150 ms as lost data. — [PhoneGyro motion-pipeline doc](https://github.com/MrHoustonOff/PhoneGyro/blob/main/docs/motion-pipeline.en.md)

### Inferences
- **Latency targets (synthesis):**
  - Aim for 50 ms or less from motion to screen for a pointer. That is near the median detection threshold, and gyro pointing exposes lag the most.
  - About 100 ms is tolerable for casual swing games. The 70 ms iPhone measurement and the roughly 133 ms PS Move estimate both sat in a "works for casual play" range.
  - Rough budget: phone sensor and event delivery (about 16 ms at 60 Hz), a 5 GHz Wi-Fi hop (a few ms to tens of ms), the PC relay (under 1 ms), Dolphin's 200 Hz step (up to 5 ms), and the game frame plus display (about 17–50 ms).
  - Send at 60–100 Hz; 10 Hz is too coarse for pointing. Avoid 2.4 GHz Wi-Fi and phone power-saving modes.
- **Starting points for swing detection, untested and to be tuned:**
  - Compute linear acceleration (Android's linear-acceleration sensor, iOS `userAcceleration`, or a low-pass gravity estimate subtracted from the raw reading).
  - Trigger a swing when its size crosses about 1.5–3 g, or when the gyro rate crosses about 300–500 °/s.
  - Take the swing direction from the dominant axis at the peak.
  - Ignore new triggers for about 250–500 ms (a refractory period). For shakes, count several spikes within about 0.5 s.
  - These numbers are not from a cited source.
- **Tilt mapping:** take pitch and roll from the gravity vector (low-passed accelerometer, or the fused orientation). Map angle to stick or steering with a small center deadzone; Dolphin's Tilt simulation uses an 85° maximum angle.
- **AirPods head pointer:** use the iPhone-provided attitude for absolute orientation, and recenter on a button. Head motion is slow and its range is limited, so use higher sensitivity (a small Total Yaw) and gentle smoothing of small movements only.

### Gaps
- I found no peer-reviewed latency threshold specific to motion or pointer controls (as opposed to button-to-visual). The 50/100 ms targets above are inferred from the Raaen study plus device measurements.
- I could not open the Devpost hackathon swing-detection project (HTTP 403) or verify CricFit's code, so I report no hackathon-specific swing thresholds.
- AirPods and Apple Watch sensor update rates (which bound the latency) are out of scope here and covered by the separate AirPods/watch notes.
