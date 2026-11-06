# Neighbor identification: verification record

## Existing hardware: guided pairing

The current hardware-free workflow is documented in
[GUIDED-NEIGHBORS.md](GUIDED-NEIGHBORS.md). It uses operator confirmation and
existing MQTT Hall telemetry; no firmware changes or new hardware are needed
when that telemetry already includes the module MAC, boot ID and sequence.

Checks completed on 2026-11-06:

- `node scripts/hall-neighbor-pairing-smoke.mjs`: **179 deterministic checks
  passed**. Covers stable two-edge candidates, explicit confirmation, multiple
  saved links, ambiguous changes, malformed/demo data, replay and retired boot
  identities, duplicate MACs, observation gaps, reconnection epochs, persistence,
  sticky invalidation, reconfirmation and removal.
- `node scripts/guided-neighbor-pairing-smoke.mjs`: passed against the actual
  console with a controlled WebSocket transport. Covers the Start/Confirm UI,
  operator labels and dashed links, reload/reconfirmation, detach, reconnect,
  gateway replacement, ambiguous edges, complete demo-packet exclusion, browser
  storage failure, permission checks, bilingual labels and mobile controls.
- Existing hardware-protocol and optional automatic-topology browser tests:
  passed.
- Locale/layout audit: passed, with 24 responsive views, 12 role upgrades,
  24 accessibility scans and **172 localization checks**, including the new
  pairing dialog and guide download.
- JavaScript syntax and patch whitespace: passed.

The browser screenshot `.artifacts/neighbors/operator-paired.png` illustrates
controlled test data. These checks do not establish that any physical pair is
attached. The operator must check the module labels; a rapid swap between
telemetry reports cannot be identified reliably by the existing Hall switches.

## Optional hardware extension

Date: 2026-11-06. This record covers the optional SC16IS752 edge interfaces,
XIAO MQTT firmware, UNO gateway and browser topology display. No board was
flashed or reset. No physical edge contact, Hall sensor, oscillator, I2C bus or
UART measurement was performed.

## Native software checks

All **401 native assertions passed** using the actual firmware and protocol
headers, mocked GPIO/I2C/networking and the installed ArduinoJson library:

| Suite | Assertions | Coverage |
| --- | ---: | --- |
| Edge identity protocol and UART driver | 99 | CRC reference vector, damaged frames, parser recovery, two-endpoint challenge exchange, replay/reboot/expiry, timer rollover, UART register banks/divisor/FIFOs and I2C errors |
| XIAO with identity disabled | 49 | Existing Hall/MQTT behavior and no I2C startup |
| XIAO with identity enabled | 91 | Six ports, identity telemetry, raw Hall detach, stale buffers, chip failure/recovery, six-peer payload size and all duplicate-ID/MAC conflicts |
| XIAO with conflicting pin configuration | 2 | Refuses startup before operating conflicting hardware |
| UNO gateway, eight configurations | 160 | Existing AP/MQTT behavior, strict optional identity validation, legacy compatibility, duplicate peers, malformed input and bounded normalized events |

Reproduce from the repository root, supplying the installed ArduinoJson `src`
directory for the MQTT sketch tests:

```sh
python3 scripts/firmware-tests/run-edge-identity-tests.py
python3 scripts/firmware-tests/run-mqtt-node-tests.py --arduinojson /path/to/ArduinoJson/src
python3 scripts/firmware-tests/run-mqtt-gateway-tests.py --arduinojson /path/to/ArduinoJson/src
```

The runners use temporary copies of public firmware files and exclude both
private secret headers. The compiler can be selected with `--compiler`.

## Browser and transport checks

- `node scripts/neighbor-topology-smoke.mjs`: passed. Exercises actual console
  code with controlled telemetry, including reciprocal IDs/sides/boot/MAC,
  27 malformed payload cases, missing hardware/data, Hall mismatch, reboot,
  offline/stale peers, automatic three-second expiry and live device details.
  Reconnecting requires fresh reports from **both** endpoints. Unrelated dialog
  content and focus are preserved. English/Traditional Chinese labels checked.
- `node scripts/hardware-protocol-smoke.mjs`: passed. Existing Hall-only
  telemetry, unavailable measurements, device discovery, firmware downloads,
  serial framing and WebSocket ownership continue to work.
- `node --test tools/mqtt-bridge/bridge.test.mjs`: passed against a local TCP
  MQTT/WebSocket fixture. Full identity events larger than 1024 bytes pass;
  retained events and events over 2048 bytes are rejected. Command limits and
  offline-command behavior are unchanged.
- `node scripts/quality-audit.mjs --locale-only`: passed: 24 responsive views,
  12 role upgrades, 24 accessibility scans and 164 localization checks.
- JavaScript syntax, matching node/gateway MQTT settings and
  `git diff --check`: passed.

These browser packets and UART fixtures are simulated test inputs, not
observations of physically connected modules. The browser smoke test writes an
illustrative screenshot to `.artifacts/neighbors/confirmed-neighbor.png`.

## Firmware compilation

Arduino CLI uses the installed Espressif ESP32 3.3.12 and Arduino UNO R4 Boards
1.6.0, with ArduinoJson and ArduinoMqttClient. Builds select public example
settings through `SOLAR_USE_EXAMPLE_SETTINGS=1`; no private configuration is
copied into the isolated build sketches.

The targets are `arduino:renesas_uno:unor4wifi` for the gateway and
`esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default` for the node. Both the default node
and the `SOLAR_EDGE_IDENTITY_ENABLED=1` variant passed compilation.

| Final build | Flash bytes | Global RAM bytes | Result |
| --- | ---: | ---: | --- |
| UNO R4 MQTT gateway | 88,888 | 9,392 | Passed |
| XIAO ESP32-C3, identity enabled | 1,003,751 | 38,780 | Passed |
| XIAO ESP32-C3, default Hall-only | 998,753 | 38,756 | Passed |

Public build copies and output are isolated under the ignored
`.artifacts/neighbor-build` directory. No upload option was used.

## Physical bring-up

Follow [NEIGHBOR-DETECTION.md](NEIGHBOR-DETECTION.md) to wire and enable the
extension. Start with two modules and check every Hall-to-UART side mapping,
actual clock frequency, crossed TX/RX contacts and current consumption. Verify
swaps, simultaneous attachments, contact interruptions, reboots and broker
outages on the real hardware before relying on the topology display.
