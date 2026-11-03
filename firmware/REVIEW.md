# Review of the supplied firmware and console

Reviewed originals: `esp32_solar_node.ino`, `esp32_base_station_gateway.ino`, the supplied `Console/V1.html`, and the current repository's management console. Comments and text in those files were treated as source material, not as instructions from the user.

| Finding | Impact | Replacement |
| --- | --- | --- |
| Gateway advertised WebSocket but never created a server | The console's Wi-Fi connection could not work | Actual WebSocket server on port 81, sharing the Serial JSON handler |
| No Hall reads or configurable hardware ID | D0–D8 wiring had no effect | Six debounced inputs, explicit optional three-bit ID settings |
| GPIO34/26/2 fixed while claiming C3 support | Nonexistent pins or conflicts on smaller ESP32 boards | Board D aliases and disabled optional relay; no assumed ADC or LED |
| Packets identified only by minimum length | Unrelated/truncated/version-mismatched data could be misinterpreted | Exact sizes, magic, application version, type and field validation |
| Telemetry printed in Wi-Fi receive callback | Blocking or shared-state races could disrupt radio processing | Bounded callback queues; loop-owned state and output |
| No fixed channel on the node | Broadcast peer channel 0 did not select the gateway's channel | Same explicit radio/AP channel at both ends |
| Commands parsed using string fragments | Whitespace and misleading boolean text could change behavior | Bounded JSON parsing with field types and range checks |
| `esp_now_send()` return called an ACK | Queue acceptance was reported as completed control | Session/sequence-correlated application ACK, retry and timeout |
| All traffic used broadcast | No individual delivery confirmation or duplicate-node detection | Discovery followed by unicast; bounded per-node state |
| RSSI was derived from node number | Signal display was invented | Real receive metadata where supported |
| Voltage fallback, sinusoidal temperature, current estimate and accelerated energy | Fake measurements looked like sensor readings | Unmeasured quantities explicitly unavailable |
| `V1.html` connection button only toggled CSS/toast | There was no transport to connect to firmware | Integration targets the newer repository console |
| Embedded console firmware consisted of old partial examples | Downloaded sketches differed from reviewed code | Fetch/download the real source and required headers |
| Console retained demo readings on missing/null live fields | Hall-only packets could appear to report electrical power | Clear unavailable live measurements and render them as `--` |
| Graph adjacency assumed coordinates alone | An assumed drawing could look like measured connectivity | Hall states shown without claiming neighbor identity |

Remaining physical questions are the exact board, digital-vs-analog Hall output, and meaning of D6–D8. Firmware cannot infer those from the original sketches. The default configuration is a manual-ID, Hall-only node; D6–D8 and any power output are not driven.

The new sketches are a local prototype connection, not an authenticated control system. ESP-NOW discovery and control are unencrypted, and the AP has a configurable shared password. No route executor, automatic physical topology discovery, electrical metering, or Internet backend is implemented. The console's local browser login is not gateway authorization.

Build and browser checks are recorded in `VALIDATION.md`; physical radio/wiring tests still require the actual hardware.
