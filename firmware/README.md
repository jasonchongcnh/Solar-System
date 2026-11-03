# Hall-sensor node and ESP-NOW gateway

For the UNO R4 WiFi access point with XIAO ESP32-C3 MQTT nodes and a broker computer joined to the UNO AP, follow [MQTT.md](MQTT.md) instead. This page documents the legacy ESP-NOW architecture.

These sketches replace the original solar-node demonstration firmware. Flash **both** ends: the new versioned binary protocol is deliberately incompatible with the old untyped packets. The browser interface remains newline JSON at 115200 baud, or JSON messages over WebSocket port 81.

## Hardware information still needed

The exact node board, Hall sensor model/output type, and D6–D8 circuit were not specified. Do not infer GPIO numbers from the printed D labels. This implementation assumes **six digital Hall switches detecting magnetic presence**, not six analog current sensors or high-speed pulse counters. Check `NodeConfig.h` before uploading.

- D0–D5 are read as digital Hall inputs, in that order. Default: active LOW with internal pull-ups and 25 ms debounce. Each input must stay stable for the debounce interval. Use a 3.3 V-compatible signal and a common ground; a 5 V module's output may need level shifting. Change polarity/input mode to match the sensor.
- D6–D8 are reserved. Hardware-ID mode is **off by default**, so the firmware leaves these pins untouched. Manual ID defaults to 1; assign a unique ID from 1 to 8 to each node.
- If D6–D8 really are three ID switches/jumpers, enable hardware-ID mode in `NodeConfig.h`. They are sampled at startup; reset after changing them. If they have another purpose, leave that mode disabled and describe the circuit before assigning it.
- No voltage divider, temperature sensor, current sensor, power relay or status LED is assumed. There are no writes to the old GPIO26/GPIO2 assignments. The optional relay pin defaults to disabled; requests to switch power then fail explicitly.

Example **only if the board is Seeed XIAO ESP32C3**:

| Printed pin | ESP32-C3 GPIO | Role |
| --- | ---: | --- |
| D0 | 2 | Hall 0 / mask bit 0 |
| D1 | 3 | Hall 1 / mask bit 1 |
| D2 | 4 | Hall 2 / mask bit 2 |
| D3 | 5 | Hall 3 / mask bit 3 |
| D4 | 6 | Hall 4 / mask bit 4 |
| D5 | 7 | Hall 5 / mask bit 5 |
| D6 | 21 | Optional ID bit 0 |
| D7 | 20 | Optional ID bit 1 |
| D8 | 8 | Optional ID bit 2 |

Use **USB CDC On Boot: Enabled** on native-USB boards. UART0 on XIAO ESP32C3 shares D6/D7. GPIO2 and GPIO8 are boot-strapping pins: firmware cannot fix a circuit that prevents the chip from booting. Check switch/sensor levels during reset against the [manufacturer's pin and boot documentation](https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/). Other ESP32 boards have different D-pin mappings; generic ESP32 Dev Module does not provide these aliases.

For the optional active-LOW ID circuit, each switch connects its pin to GND when closed and uses a pull-up when open. LOW contributes 1; `nodeId = 1 + bit0 + 2*bit1 + 4*bit2`.

| Node ID | D8 (bit 2) | D7 (bit 1) | D6 (bit 0) |
| ---: | --- | --- | --- |
| 1 | HIGH | HIGH | HIGH |
| 2 | HIGH | HIGH | LOW |
| 3 | HIGH | LOW | HIGH |
| 4 | HIGH | LOW | LOW |
| 5 | LOW | HIGH | HIGH |
| 6 | LOW | HIGH | LOW |
| 7 | LOW | LOW | HIGH |
| 8 | LOW | LOW | LOW |

This logical truth table does not certify that all switch positions are electrically safe on a particular board's boot-strapping pins.

## Connection

```text
6 digital Hall switches -> node -> ESP-NOW channel 1 -> gateway -> USB -> console
                                                       |
                                                       +-> Wi-Fi AP / WebSocket -> console
```

Prefer USB from the gateway to the computer for the hosted HTTPS console. It avoids local Wi-Fi switching and the browser's HTTPS-to-insecure-WebSocket restrictions. ESP-NOW still carries the node traffic wirelessly.

The node first broadcasts a telemetry packet. A gateway receipt establishes its station MAC and boot session. Subsequent telemetry uses unicast with receipts/retries. When receipts stop, the node returns to discovery. Gateway commands are unicast to known, fresh nodes and are successful only after a matching application acknowledgement. Retries reuse the command sequence; the node does not repeat an already-applied command.

Both sketches use `RADIO_CHANNEL` in their identical `SolarProtocol.h` files (default 1). The gateway AP uses that same channel. Do not connect the gateway as a station to an arbitrary router: that can change the radio channel and break ESP-NOW. This is a star network, not a mesh. It uses ordinary ESP-NOW, not Wi-Fi LR mode. It does **not** authenticate or encrypt ESP-NOW packets; use the default auto-discovery mode only on a trusted bench/test network. A pinned gateway MAC limits accidental pairing but is not cryptographic authentication.

ESP-NOW callbacks only copy fixed-size data into bounded queues; processing happens in `loop()`. The design follows [Espressif's channel, callback and application-acknowledgement guidance](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/network/esp_now.html).

## Build and upload

Each sketch directory is self-contained: keep its `.ino`, config `.h`, and `SolarProtocol.h` together. The two protocol headers must stay identical. The console firmware dialog offers the actual files rather than embedded example code.

Use Arduino IDE with **esp32 by Espressif Systems 3.3.11** (the tested core). Install these gateway libraries using Library Manager:

- **ArduinoJson 7.4.3** by Benoit Blanchon.
- **WebSockets 2.7.2** by Markus Sattler / Links2004 (not ArduinoWebsockets).

The node needs only the ESP32 core. Select the actual board for each device. A successful XIAO build verifies the code for that example target; it does not identify your hardware. Check the node config, select the port, and upload using Arduino IDE. This repository update does not upload or reset attached boards automatically.

Example CLI commands with dependencies already installed:

```powershell
arduino-cli compile --jobs 2 --fqbn esp32:esp32:esp32 firmware/esp32_base_station_gateway
arduino-cli compile --jobs 2 --fqbn esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default firmware/esp32_solar_node
```

For the tested core, the XIAO CLI value `CDCOnBoot=default` means **Enabled**; `CDCOnBoot=cdc` means **Disabled**. The node intentionally rejects the disabled setting because UART logging would use wired pins.

The node's default XIAO configuration uses board D aliases. For a board without those aliases, replace the pin arrays with verified GPIO assignments. Do not substitute GPIO0–GPIO8 automatically.

## Open the management console

Use this repository's `management-console.html`. The supplied `L:/.../Console/V1.html` is an older simulation-only page and cannot consume hardware data. No firmware change can turn its simulated connection button into Web Serial.

For USB: open the management console in desktop Chrome/Edge on HTTPS or localhost; click **Connect ESP32 (USB Serial)**, select the gateway, and use 115200 baud. Close Arduino Serial Monitor first so it does not hold the port. Send `{"cmd":"ping"}` in the packet terminal if needed.

For wireless access:

1. Serve the repository from a computer, for example `python -m http.server 8000 --bind 0.0.0.0` in its root. Allow the server on the intended local network if the firewall asks.
2. Connect the computer and client to `HexagonSolar-BaseGateway`, password `hexagonsolar888`. Keep the client on that AP even though it has no Internet access. Change the AP password in `GatewayConfig.h` for your installation.
3. On the computer, open `http://localhost:8000/management-console.html`. On a phone, open `http://<computer-IP-on-the-gateway-AP>:8000/management-console.html`. Find that IP with `ipconfig`; it is usually in `192.168.4.x`.
4. Select the console's Wi-Fi gateway connection and enter `ws://192.168.4.1:81`.

The gateway serves WebSocket data, not a copy of the complete console site. An HTTPS-hosted page may block `ws://` as mixed content; use the local HTTP setup above, USB, or a separately configured TLS reverse proxy. A LAN address works only where routing actually reaches this AP; router station mode is not implemented.

## Data and commands

Hall readings are present/absent states, with bit 0 = D0 through bit 5 = D5. `halls` lists those six booleans. Presence alone does not reveal a neighboring module's ID or orientation. Default q/r positions match the console's initial layout; they are configured display positions, not measured topology. The firmware rejects `set_path` because no inspection robot or path executor is implemented.

Example telemetry shape (MAC/RSSI below are illustrative):

```json
{"type":"telemetry","id":1,"q":0,"r":0,"hall_mask":5,"halls":[true,false,true,false,false,false],"config_bits":null,"power_control_available":false,"enabled":true,"status":"online","voltage":null,"current":null,"power":null,"temp":null,"rssi":-61,"mac":"02:00:00:00:00:01","uptime":42,"seq":12,"boot_id":1234}
```

Without a configured relay, `enabled:true` means that sensing is running; it does not assert that a power output is switched on. Missing measurements are JSON `null`, not invented zeros or retained simulation values. The console displays unavailable measurements as `--`. Existing demo energy calculations are not a calibrated metering system; this Hall-only firmware does not generate electrical/temperature data.

| Command | Behavior |
| --- | --- |
| `{"cmd":"ping"}` | Gateway `pong`, identity and radio information |
| `{"cmd":"request_telemetry","id":1}` | Request fresh telemetry from a known node |
| `{"cmd":"request_telemetry"}` | Request telemetry from all known fresh nodes |
| `{"cmd":"set_power","id":1,"enabled":true}` | Only supported if that node has a configured relay |
| `{"cmd":"all_power","enabled":false}` | Per-node unicast requests, each with its own final result |

`tx_pending` means queued/waiting. `tx_ack` with `success:true` and `stage:"applied"` means the node acknowledged the command. That is confirmation of its software state, not independent electrical feedback from the load. Unsupported requests, invalid JSON, unavailable nodes and delivery timeouts produce explicit errors/failures. Serial messages exceeding the input limit are discarded through the next newline. Keep commands on one line.

## Verification on real boards

Compilation and browser tests cannot measure radio reliability or certify wiring. Before use:

1. Start a gateway and one node; confirm `ready`, real node MAC/RSSI, six Hall states, and unavailable electrical readings.
2. Move a magnet to each input separately. Confirm D0–D5 ordering and polarity; check that contact bounce does not create repeated changes.
3. If hardware-ID mode is appropriate, verify all intended switch settings and reset/boot behavior; make every node ID unique.
4. Power-cycle the gateway, then the node. Verify automatic rediscovery; disconnect the node and confirm stale data is shown without invented updates.
5. Try an unsupported power command with the default Hall-only configuration; it must fail. With a correctly configured relay, verify OFF startup, command ACKs, and the actual load state separately.
6. Repeat with all nodes and with USB/WebSocket clients. Temporarily move a node out of range and verify bounded retries and recovery.

See [REVIEW.md](REVIEW.md) for the problems found in the originals and the implementation limits.
