# Verification record

Validation completed against the source in this repository. No ESP32 was flashed or reset, and no physical sensor or radio-range test was performed.

## Toolchain

- Arduino CLI 1.5.1, Espressif Arduino-ESP32 core 3.3.11.
- Gateway dependencies: ArduinoJson 7.4.3 and Links2004 WebSockets 2.7.2.
- Dependencies for this session were installed in the temporary `hexagon-solar-firmware/user/libraries` folder, using a separate CLI config. They were not added to the user's Arduino sketchbook.
- Build outputs are temporary. The checked-in sketches/configuration are the deliverable; select the actual boards before uploading.

## Board compilation

- Node passed for `esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default` on 2026-09-30: 944,603 bytes of flash (72%) and 35,940 bytes of global RAM (10%).
- Gateway passed for `esp32:esp32:esp32` on 2026-09-30: 939,243 bytes of flash (71%) and 49,560 bytes of global RAM (15%).
- Native USB disabled was correctly rejected by the node's pin-conflict guard. Earlier concurrent builds exhausted system memory; verification was completed with bounded compiler parallelism.
- ESP32-S3 and ESP32-C6 board builds are not claimed. Their pin aliases differ; selecting an example target does not establish the user's physical board model.

## Native firmware behavior tests

Both harnesses compile the actual sketch source with mocked SDK, GPIO and radio APIs. The gateway harness uses the real ArduinoJson parser.

- Node: passed in manual-ID/no-relay mode and hardware-ID/relay mode. Covers input debounce and timer rollover, untouched D6–D8 in manual mode, hardware-ID sampling, initialization failure, receipt/session validation, bounded queues, duplicate/stale commands, no repeated relay writes, retry exhaustion, and one transmission at a time.
- Gateway: 75 checks passed. Covers strict JSON types, whitespace, trailing junk/concatenated objects, Serial overflow recovery, unknown sensor values, real RSSI propagation, peer-registration failure, duplicate IDs and telemetry, reboot handling, correlated application ACKs, retry exhaustion, radio scheduling fairness, and send-callback timeout handling.
- The node and gateway `SolarProtocol.h` files are byte-for-byte identical. Their fixed packet layouts are also checked by C++ `static_assert`.

Reproduce on a machine with Python and a GCC-compatible C++14 compiler:

```text
python scripts/firmware-tests/run-node-tests.py --compiler /path/to/g++
python scripts/firmware-tests/run-gateway-tests.py --compiler /path/to/g++ --arduinojson /path/to/ArduinoJson/src
```

Windows compiler used here: `C:/Program Files (x86)/Dev-Cpp/MinGW64/bin/g++.exe`. The runners add MinGW's packed-struct ABI flag so desktop structs match the ESP32 wire layout.

## Browser and existing regression checks

Passed on 2026-09-30:

```text
node --check assets/js/management-console.js
node --check assets/js/management-console-i18n.js
node scripts/hardware-protocol-smoke.mjs
node scripts/responsive-smoke.mjs
```

The hardware test covers six Hall bits, unavailable measurements, node discovery, honest command failures, source-file downloads, stale node rendering despite a fresh gateway heartbeat, retention after disconnect, split/oversized Serial input, release of port locks, USB read failure, encoded command writes, WebSocket ownership races and reconnect cancellation. It blocks external font requests so network font loading does not control the test result.

The existing report script syntax check and daily-summary generation also passed on 2026-09-29. The responsive suite verifies the existing dashboard layout and demo-mode behavior.

## Files and remaining hardware checks

The original supplied firmware and guide were backed up at:

`L:/My Drive/2526-潛能拓展創新菁英賽/Console/firmware-backup-20260929-171059/`

The exact physical node board, Hall sensor output type/polarity, and D6–D8 circuit remain unconfirmed. The default source leaves D6–D8 untouched, uses manual ID 1, and configures no relay output. Follow the physical verification steps in [README.md](README.md) before use. All nodes need unique IDs.
