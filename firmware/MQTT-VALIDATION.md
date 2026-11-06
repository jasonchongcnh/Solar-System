# UNO access point / MQTT verification

The current [verification record](NEIGHBOR-VALIDATION.md) covers both
[guided pairing with existing hardware](GUIDED-NEIGHBORS.md) and the
[optional automatic edge-identity extension](NEIGHBOR-DETECTION.md).
The results below describe the earlier Hall-only/AP baseline.

Date: 2026-11-03. This record covers the UNO-hosted AP and XIAO MQTT clients. No board was flashed or reset. No physical Hall, radio-range, power-consumption, AP capacity or real Mosquitto/UNO integration measurement is claimed.

## Firmware builds

Arduino CLI 1.5.1, ArduinoJson 7.4.3 and ArduinoMqttClient 0.1.8. Libraries and build output were isolated under the ignored `tmp/mqtt-arduino` directory. Existing installed board cores were used; the Arduino sketchbook was not modified. The builds selected public example settings with `--build-property compiler.cpp.extra_flags=-DSOLAR_USE_EXAMPLE_SETTINGS`, so private Secrets.h and AccessPointSecrets.h were not included. Shared AP/MQTT headers and public examples were checked byte-for-byte between sketches.

| Sketch | Board core and target | Result |
| --- | --- | --- |
| UNO R4 AP / MQTT gateway | Arduino UNO R4 Boards 1.6.0; `arduino:renesas_uno:unor4wifi` | Passed. Flash 86,976 / 262,144 bytes; global RAM 9,392 / 32,768 bytes. |
| XIAO ESP32-C3 AP client / MQTT node | Espressif ESP32 3.3.12; `esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default` | Passed. Flash 972,625 / 1,310,720 bytes; global RAM 37,588 / 327,680 bytes. |

The XIAO target matches the requested model; pin mapping and sensor electrical behavior still need verification before upload. UNO WiFiS3 uses the stock connectivity-module firmware; it is not replaced by an ESP32 sketch.

## Software checks

- Native AP gateway tests: **109 passed** across eight configurations. Exercise the actual `.ino` and UnoAccessPoint.h with mocked WiFiS3/modem/MQTT and real ArduinoJson. Covers explicit nine-station startup, MODE before AP command, disabling modem debug, rejected commands and responses, no five-slot fallback, legal command-buffer bounds, malformed credentials, limits below nine/above ten, optional ten-slot configuration, and independent telemetry/ACK routing for all eight node IDs. Also covers healthy AP statuses, inherited AP reconfiguration after RA4M1 reset, broker outages without AP restart, AP-loss command cancellation, recovery backoff/timer rollover, missing module and telemetry validation.
- Native XIAO tests: **47 passed**. Exercise the actual node `.ino` with mocked hardware/networking and real ArduinoJson. Deliberately incorrect legacy router macros prove the shared AP SSID/password and `.250` broker are used. Covers dropping an old association, reconnect behavior, untouched D6–D8, Hall debounce/masks, telemetry, rejected retained/expired/stale/wrong-boot commands and duplicate ACK handling. These are software tests, not electrical or radio measurements.

- `node --test tools/mqtt-bridge/bridge.test.mjs`: passed. Real MQTT.js TCP client and WebSocket server tested against a small MQTT 3.1.1 broker fixture. Covers event forwarding, retained-event rejection, non-retained command publication, unsupported commands and failure without offline command queuing. This fixture is not Mosquitto and does not execute board firmware.
- `node scripts/hardware-protocol-smoke.mjs`: passed. Existing browser tests cover Hall mapping, missing measurements, discovery, command errors, actual firmware-source serving, Serial framing/cleanup and WebSocket ownership.
- `node scripts/quality-audit.mjs --locale-only`: passed, 152 localization checks, 24 responsive view results, 12 role upgrades and 24 accessibility scans. Includes both public AP headers and UnoAccessPoint.h in firmware-source byte checks. The final run used `SOLAR_TEST_LOW_MEMORY=1` and Node's `--max-old-space-size=128` after an ordinary browser run exhausted local memory. That test-only option limits renderer memory/process count and disables GPU acceleration; it does not alter production behavior. The untranslated terminal-title issue found during validation was fixed before the successful runs. Final results are in `.artifacts/quality/results.json` with an empty errors array.
- JavaScript syntax and patch whitespace checks passed.

Bridge runtime: Node.js 24.20.0, MQTT.js 5.16.1 and ws 8.22.0, locked in `tools/mqtt-bridge/package-lock.json`.

Reproduce the native tests (with a GCC-compatible compiler and ArduinoJson's src path):

```powershell
python scripts/firmware-tests/run-mqtt-gateway-tests.py --compiler 'C:/Program Files (x86)/Dev-Cpp/MinGW64/bin/g++.exe' --arduinojson tmp/mqtt-arduino/user/libraries/ArduinoJson/src
python scripts/firmware-tests/run-mqtt-node-tests.py --compiler 'C:/Program Files (x86)/Dev-Cpp/MinGW64/bin/g++.exe' --arduinojson tmp/mqtt-arduino/user/libraries/ArduinoJson/src
```

Both runners copy only public sketch/header files into a temporary directory and exclude both private secret filenames.

## Eight-node AP capacity

The user requires five to eight XIAOs, so the gateway explicitly requests **nine AP station slots** (eight nodes plus the broker computer). The standard WiFiS3 beginAP overload does not send the maximum-connection argument; UnoAccessPoint.h uses the public modem interface to send MODE 2 followed by the stock bridge's five-argument BEGINSOFTAP command. It checks both successful transport and exact response `1`. On rejection it stops the AP, reports `access_point_capacity_rejected` and retries with backoff; it never silently uses the five-station default. SSID/password commas and control characters are rejected because this interface uses raw CSV arguments, and formatted command length is checked against the modem buffer.

Reference connectivity firmware: official bridge 0.6.0, whose handler forwards the requested count to the ESP32-S3 Wi-Fi driver. Startup and heartbeat JSON include `ap_max_stations_requested`, `ap_capacity_accepted` and `connectivity_firmware`. Acceptance is not a station-count readback or a physical concurrency result; the stock bridge exposes no AP-capacity readback command. Real association and traffic tests with eight XIAOs plus PC remain required. Set `SOLAR_AP_MAX_STATIONS` to 10 if a separate phone must also join with all eight nodes. [Official handler](https://raw.githubusercontent.com/arduino/uno-r4-wifi-usb-bridge/0.6.0/UNOR4USBBridge/cmds_wifi_softAP.h), [ESP32-S3 driver guide](https://docs.espressif.com/projects/esp-idf/en/v4.4.5/esp32s3/api-guides/wifi.html)

## Bring-up still required

Join the broker computer to `HexagonSolar-UNO-R4` and assign `192.168.4.250/24`; run Mosquitto on that computer. Use matching AccessPointSecrets.h settings on UNO/XIAOs if customizing the example AP credentials; old router credentials and broker-host macros in Secrets.h are ignored. Assign unique node IDs 1–8. Upload both sketches and verify all six Hall inputs, command rejection without a relay, disconnect/reconnect behavior, duplicate-ID errors and data expiration. Verify client forwarding, DHCP leases, timing, nine-device capacity and power consumption on the actual hardware. See [MQTT.md](MQTT.md).

## Earlier router-mode results

The 2026-10-17 router-mode builds used 83,872 flash / 9,372 global RAM bytes on the UNO and 972,347 flash / 37,588 global RAM bytes on the XIAO example target. That earlier software record had 140 localization checks. Those results were superseded by the AP-mode checks above and do not establish AP hardware performance.
