# Morning test: do your iPhone, AirPods and Watch really get logged? (about 5 minutes)

Everything below was checked overnight with simulated devices, over both HTTP and HTTPS. It all worked: rows were saved, the Devices screen showed them live, and the CSV export returned every row.

Nothing has been tried with real hardware yet. Three things are still unchecked:

- the iPhone motion permission and the certificate warning;
- Sensor Logger's real AirPods and Watch pushes;
- the firewall on whichever Wi-Fi you are on.

This test settles them.

You need the laptop, an iPhone, and AirPods with head tracking: AirPods 3rd generation or later, any AirPods Pro, or AirPods Max. The Apple Watch and the walk test are optional.

## 0. Start the server (1 minute)

1. Put the laptop and the iPhone on the same Wi-Fi. If the venue Wi-Fi blocks phone-to-laptop traffic, join the laptop to the iPhone's hotspot instead.
   - Join the network **before** starting the server. If you switch networks later (for example to the hotspot), stop the server and start it again: it then prints the new address and makes a certificate for it.
2. In the project folder, run:

   ```bash
   python run.py
   ```

   Leave it running. It prints the addresses to use, with the laptop's current IP address. Use the printed addresses, not the ones in this file: the IP can change between networks.
3. On the laptop, open **http://localhost:8765/#devices** (Devices and data, in the sidebar).

**Success:** the top panel says **Server live: Answering** and **Phone pages (HTTPS): On**. The same screen lists every address under "Connect a device", with Copy buttons.

**Firewall, already checked (04:00, 8 Nov):**

- Windows Firewall allows `C:\Python313\python.exe` in on **Public** networks, TCP and UDP.
- Your Wi-Fi "Sohail" is marked Public, so phones can reach the server there.
- There is no rule for **Private** networks. On a network marked Private, run the firewall command from "If something fails" below once.

## 1. The iPhone's own motion (1 minute)

1. In Safari on the iPhone, type the printed address **in full, starting with `https://`**: **https://<laptop-ip>:8443/gyro/phone.html**. Safari does not add `https://` for you. Without it, the page loads over plain HTTP and gets no motion data.
2. A certificate warning appears once. Tap **Show Details**, then **visit this website**, then **Visit Website**.
3. Tap **Start motion sensors**, then **Allow**.

**Success on the laptop:**

- A **phone** card appears under Live devices with a **Measured** tag and **LIVE**.
- Its rate is above 0 Hz, and its "In the database" count keeps rising.
- Turning the phone moves its line on the chart.

## 2. AirPods, through Sensor Logger (2 minutes)

This is the step nobody has seen work yet. It is the one that answers "can I actually connect AirPods to it?"

1. Install **Sensor Logger** (free, App Store, iOS 16.4 or later). Put the AirPods in your ears.
2. In Sensor Logger, turn on **Headphone**. You can also turn on Gyroscope, which gives a "phone (Sensor Logger)" device.
3. Open the settings (the gear on the Logger page) and turn on **HTTP Push**.
4. Set the URL to the printed **http://<laptop-ip>:8765/sensorlogger**. It is plain `http` on port 8765, not the 8443 HTTPS address.
5. Tap **Tap to Test Pushing**. If iOS asks for Local Network access, allow it.
6. Start a recording, then move your head.

**Success on the laptop:**

- An **airpods** card appears with **Measured** and **LIVE**, at about 25 Hz.
- Its database count jumps about once a second, because the free tier pushes one batch per second.
- Turning your head moves the airpods line on the chart.

**If only "phone (Sensor Logger)" appears:** the push works, but Sensor Logger is not sending headphone motion. Check that Headphone is on and the AirPods are connected while recording. Write down what Sensor Logger shows, because that is the finding.

## 3. Apple Watch (optional, 1 minute)

1. Open the Sensor Logger app on the Watch.
2. In Sensor Logger on the iPhone, pick the **Phone & Watch** mode and turn on **Wrist Motion**. Keep the Watch app open while recording.

**Success:** a **watch** card, Measured, LIVE, with its count rising.

## 4. Walk test (optional, 1 minute)

1. On the iPhone, type the printed **https://<laptop-ip>:8443/motion/walk.html** in full, with `https://`.
2. Turn the iPhone's **Silent mode off and the volume up**: a beep marks GO and the stop.
3. Follow the steps for a 10 m walk. **Stand still at the start line until the beep**, then walk at your usual pace. **Do not tap Stop while still walking**: that walk is refused as unusable, on purpose.
4. To show the walking flag on stage, follow "Demo flag" in `motion/README.md`. Save the staged walks under the name **Demo (dates moved)**, and say on stage that the dates were moved for the demo.

**Success:**

- The **Phone walking test** card on the Devices screen shows the new walk.
- **Newest sessions** gets a "Walk upload" row tagged **Imported** (one upload, not a live stream).

## 5. Proof that it is saved (30 seconds)

1. Under **Newest sessions**, your real sessions have no Simulated tag. Click **CSV** on one: it downloads every stored sample.
2. Press **Ctrl+C** in the server window, then run `python run.py` again.

**Success:** the counts are all still there. They live in `data/rfn.sqlite` on the laptop. Nothing in `data/` is ever committed.

The database also holds last night's simulated test runs: devices and walks named "(simulated)", all labelled. To start the demo with an empty database:

1. Stop the server with Ctrl+C.
2. Move the database files aside together, as in "Reset" in `docs/DATABASE.md`. That one PowerShell line moves `rfn.sqlite`, `rfn.sqlite-wal` and `rfn.sqlite-shm` into a dated `data\old-…` folder; nothing is deleted.
3. Start the server again. It creates a new, empty file.

None of this data changes the red-flag number, on purpose. The Devices screen proves the pipeline. The indicator uses only weekly home tests, each judged against a normal-variation figure from published data.

## If something fails

| What you see | Likely cause | Fix |
|---|---|---|
| The phone page never loads | Windows Firewall, or Wi-Fi that blocks phone-to-laptop traffic | Allow Python when Windows asks, on Public networks too. Or run the `New-NetFirewallRule` command shown on the Devices screen in an administrator PowerShell. Or use the iPhone hotspot. |
| The page loads but no motion arrives | Opened the `http` address, or tapped Don't Allow | Type the `https://…:8443` address in full. Close the tab and open it again to get the prompt back. |
| The phone says the page "didn't send any data" or the server "dropped the connection" | The address was typed without `https://` | Type it in full, starting with `https://`. |
| It worked, then stopped after switching to the hotspot | The laptop's address changed | Stop the server and start it again, then use the new address it prints (the Devices screen shows it too after a reload). |
| No beep during the walk test | Silent mode is on | Turn Silent mode off and the volume up. |
| "Tap to Test Pushing" fails | Wrong URL, or Local Network access is off | The URL must be `http://<laptop-ip>:8765/sensorlogger`. Turn on iPhone Settings, Privacy & Security, Local Network, Sensor Logger. |
| Nothing connects on venue Wi-Fi, even with the firewall allowed | Client isolation | Use the iPhone hotspot. Or, for demo data only, run a tunnel: `ssh -R 80:localhost:8765 localhost.run`. Then use `<tunnel>/gyro/phone.html` on the phone and `<tunnel>/sensorlogger` in Sensor Logger, and keep the laptop on `http://localhost:8765`. A tunnel sends the data through a third-party server. |
| You want to show the pipeline with no phone at all | No hardware nearby | `python server/simulate.py --url http://localhost:8765 --walk`. Every device it creates is named "(simulated)" and tagged Simulated. |
