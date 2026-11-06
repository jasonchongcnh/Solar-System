# UNO R4 WiFi access point and XIAO ESP32-C3 MQTT nodes

The **UNO R4 WiFi creates the Wi-Fi access point**. XIAO ESP32-C3 nodes and the computer running Mosquitto join that access point. No external router or Internet connection is required. Upload the current MQTT sketches to both the UNO and the nodes.

```text
UNO R4 WiFi AP: HexagonSolar-UNO-R4, 192.168.4.1
    |
    +-- XIAO ESP32-C3 nodes: DHCP, MQTT clients, six Hall inputs each
    |
    +-- Computer: static 192.168.4.250, Mosquitto broker on TCP 1883
             |
             +-- MQTT-to-WebSocket bridge: ws://127.0.0.1:8081
             +-- Local console: http://localhost:8000/management-console.html

UNO MQTT gateway <-> broker <-> node MQTT clients
UNO USB Serial ----------------> console (alternative to WebSocket bridge)
```

The broker continues to run on the computer/Raspberry Pi, now joined to the UNO's AP. The UNO creates the network and acts as the application gateway; it does not run Mosquitto or route Internet traffic. Keep its stock ESP32-S3 connectivity firmware. Standard sketches execute on the RA4M1 and use WiFiS3. [Arduino hardware documentation](https://docs.arduino.cc/hardware/uno-r4-wifi/)

## 1. Configure and upload the firmware

Install **Arduino UNO R4 Boards**, **esp32 by Espressif Systems**, **ArduinoJson 7** and **ArduinoMqttClient** through Arduino IDE. WiFiS3 comes with the UNO R4 board package. Download these dependencies before joining the AP if this computer has no other Internet connection.

For the UNO, open `uno_r4_mqtt_gateway/uno_r4_mqtt_gateway.ino` and select **Arduino UNO R4 WiFi**. For each XIAO, open `esp32_mqtt_solar_node/esp32_mqtt_solar_node.ino` and select **XIAO_ESP32C3**. The two sketch folders are self-contained; keep each sketch's headers alongside its `.ino`.

The default network is **HexagonSolar-UNO-R4**, example password **hexagonsolar888**, AP address **192.168.4.1**. The shared `AccessPointConfig.h` defines `APConfig::SSID`, `APConfig::PASSWORD`, `APConfig::BROKER_HOST` and `APConfig::MAX_STATIONS`. MQTT clients use broker address **192.168.4.250**, port **1883**. The broker address is the computer, not the UNO AP address. Keep `UnoAccessPoint.h` in the UNO sketch folder; the XIAOs do not use that helper.

To customize the network, copy `AccessPointSecrets.example.h` to ignored `AccessPointSecrets.h` in **both sketch folders**, then set identical `SOLAR_AP_SSID`, `SOLAR_AP_PASSWORD` and `SOLAR_AP_BROKER_HOST` values. Change the example password consistently before an installation. SSIDs must fit 1–32 bytes and passwords 8–63 bytes; neither may contain commas or control characters because the official connectivity-module command uses comma-separated arguments. Existing Secrets.h files remain private and supply MQTT username/password/port; their old `SOLAR_WIFI_SSID` and `SOLAR_MQTT_HOST` values are ignored in AP mode. Keep MQTT topic root and gateway identity consistent between sketches. MQTT username/password may remain empty for the isolated demonstration broker profile.

Configure each node's `NodeConfig.h`: assign a unique `MANUAL_NODE_ID` from 1 through 8 and confirm GPIO mapping, Hall polarity and output voltage. D0–D5 remain six digital Hall inputs with 25 ms debounce; D6–D8 hardware-ID mode remains optional and disabled. No relay is assumed. Enable **USB CDC On Boot** on the XIAO ESP32-C3 so logging does not drive the wired D6/D7 pins.

For automatic identification of the module attached to each edge, install the optional six-port UART hardware and enable it in `NodeConfig.h`. See [NEIGHBOR-DETECTION.md](NEIGHBOR-DETECTION.md) for the three SC16IS752 bridges per module, contact wiring, configuration and live status. Hall-only operation remains the default until that hardware is fitted.

For the requested **five to eight XIAOs**, this program explicitly requests **nine AP stations**: eight XIAOs plus the broker computer. `APConfig::MAX_STATIONS` defaults to 9. The ordinary WiFiS3 `beginAP` API leaves the reviewed official bridge's default at five; the UNO-only `UnoAccessPoint.h` helper instead supplies the bridge command's fifth `max_connection` argument. This retains the standard UNO connectivity firmware and uses its existing command interface. [Official bridge AP command](https://raw.githubusercontent.com/arduino/uno-r4-wifi-usb-bridge/main/UNOR4USBBridge/cmds_wifi_softAP.h), [Espressif ESP32-S3 AP station configuration](https://docs.espressif.com/projects/esp-idf/en/v4.4.5/esp32s3/api-guides/wifi.html)

Use official UNO connectivity firmware **0.6.0 or a compatible release** that accepts this argument. If startup reports `access_point_capacity_rejected`, the program stops the AP instead of silently falling back to a five-client network. Follow Arduino's [connectivity firmware update instructions](https://support.arduino.cc/hc/en-us/articles/9670986058780-Update-the-connectivity-module-firmware-on-UNO-R4-WiFi); do not replace that module's firmware with the node sketch. A successful command or compilation does not prove nine simultaneous connections: test the requested number of XIAOs and the broker computer on the actual boards.

The UNO needs power and Wi-Fi; there is no UART wire between it and the XIAOs. Its Hall sensor inputs are not used. Sensor outputs connected to the XIAOs must remain safe for 3.3 V inputs.

## 2. Join the UNO AP and start Mosquitto

Start the UNO and confirm its Serial output reports the AP as active. Connect the broker computer's Wi-Fi adapter to **HexagonSolar-UNO-R4**. A “No Internet” warning is expected; stay connected.

Set that computer's Wi-Fi adapter IPv4 address manually to **192.168.4.250**, subnet mask **255.255.255.0**. No default gateway or DNS server is needed for this isolated network. The high static address avoids the AP's low DHCP lease addresses; leave nodes on DHCP. If changing the default network, verify its DHCP lease range before choosing a broker address. Restore the computer's adapter to automatic/DHCP when returning to its usual Wi-Fi network. This guide does not modify host network settings for you.

Install Eclipse Mosquitto on the computer and run from the repository root:

```powershell
mosquitto -c mqtt/mosquitto.conf -v
```

Allow inbound TCP 1883 on the broker's UNO-AP Wi-Fi adapter. Windows may classify a no-Internet AP as Public; select a firewall rule scoped to the intended adapter/subnet rather than opening the broker on every network. The supplied broker profile uses anonymous, unencrypted MQTT for this isolated demonstration. Shared deployments need broker authentication/ACLs and a matching TLS client implementation. [Mosquitto configuration](https://mosquitto.org/man/mosquitto-conf-5.html)

Start one XIAO first and check its AP association and MQTT connection. The UNO itself connects to the broker at **192.168.4.250:1883** over its AP network. Add the remaining nodes after telemetry from the first reaches the console. Neither `127.0.0.1` nor `192.168.4.1` is the broker address from a board.

## 3. Connect the console

**USB:** connect the UNO's USB port to a desktop computer, open `management-console.html` in Chrome/Edge on localhost or HTTPS, click **Connect gateway (USB Serial)** and select the UNO at 115200 baud. Close Arduino Serial Monitor first. USB requires no bridge process.

**Wireless console through the broker:**

```powershell
cd tools/mqtt-bridge
npm ci
$env:MQTT_URL = 'mqtt://127.0.0.1:1883'
npm start
```

In another terminal, serve the repository from its root:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/management-console.html`. In the Wi-Fi gateway dialog enter **`ws://127.0.0.1:8081`**. This is the bridge on the broker computer, not a WebSocket server on the UNO. Keep the computer joined to the UNO AP. Previously saved settings may contain the old ESP32 address; edit it if needed.

The bridge listens on loopback by default and accepts browser origins `http://localhost:8000` and `http://127.0.0.1:8000`. To serve a phone, join it to the UNO AP, bind the HTTP server to `0.0.0.0`, set `WS_HOST=0.0.0.0` and set `WS_ORIGINS=http://192.168.4.250:8000`. On the phone open `http://192.168.4.250:8000/management-console.html` and enter `ws://192.168.4.250:8081`, not 127.0.0.1. Allow these ports on the broker computer's AP adapter. The phone needs another station slot: for eight XIAOs plus broker computer plus phone, configure `APConfig::MAX_STATIONS` to **10** before uploading the UNO. Otherwise keep the total at nine clients or fewer. HTTPS pages require a separately configured `wss://` proxy or USB because browsers block insecure mixed content.

Other bridge environment settings are `MQTT_USER`, `MQTT_PASSWORD`, `MQTT_ROOT`, `MQTT_GATEWAY` and `WS_PORT`. No browser MQTT credentials are embedded in the website. Only one live console transport should be selected at a time.

## Topics and semantics

| Topic | Publisher → subscriber | Content |
| --- | --- | --- |
| `hexagon/v1/nodes/1/telemetry` | Node 1 → UNO via broker | Six-bit Hall mask, optional per-edge identities, node boot ID/sequence, uptime, MAC and UNO AP RSSI |
| `hexagon/v1/nodes/1/command` | UNO → node 1 | Node/gateway boot IDs, command sequence and node-uptime deadline |
| `hexagon/v1/nodes/1/ack` | Node 1 → UNO | Correlated result; a publish is not an actuator confirmation |
| `hexagon/v1/nodes/1/status` | Node 1 → broker observers | Retained online/offline availability and Last Will |
| `hexagon/v1/gateways/uno-r4/events` | UNO → bridge/subscribers | Existing console JSON: telemetry, heartbeat, errors and command results |
| `hexagon/v1/gateways/uno-r4/command` | Bridge/operator → UNO | Existing console commands: ping, request_telemetry, set_power, all_power |
| `hexagon/v1/gateways/uno-r4/status` | UNO → broker observers | Retained online/offline availability and Last Will |

Substitute node numbers 1–8. Telemetry, events, commands and ACKs are **not retained**; receivers reject retained JSON messages. Sessions are clean and the bridge disables offline command queuing. Application messages use QoS 0; periodic telemetry replaces lost samples. Control commands have at most three attempts and require node ACKs. The node caches the last result to avoid repeating an identical command. Node-boot matching and short deadlines reject old commands; this is not cryptographic authentication. Use broker ACLs to restrict who can publish commands in a deployed system.

The UNO validates node IDs, topic/payload matching, sequence order, Hall-mask range and required JSON types. Fresh duplicate IDs from different node MACs are reported. Node data expires after 15 seconds without new telemetry. Reconnecting does not replay buffered history. No offline historical data store is implemented.

`set_power` returns failure on the default Hall-only node because no relay is configured. Electrical measurements remain JSON null and display as `--`. Coordinates are configured display positions. Hall presence alone does not identify neighboring modules; the optional edge UART exchange supplies identities, and the console confirms fresh reciprocal reports. Legacy packets without edge identities remain Hall-only. Neither detection mode proves structural strength or a working power connection. The original nodes using ESP-NOW cannot communicate with this MQTT gateway until reflashed.

## Validation

Build targets, dependency versions and completed software checks are recorded in [MQTT-VALIDATION.md](MQTT-VALIDATION.md). Earlier router-mode results do not establish real AP capacity or connectivity.

Run `npm test` inside `tools/mqtt-bridge` for the TCP MQTT/WebSocket integration fixture (event forwarding, retained-message rejection, non-retained commands, and offline command failure). It does not validate physical sensors, UNO connectivity firmware or a real Mosquitto deployment.

Compile with Arduino CLI and installed board cores/libraries:

```powershell
arduino-cli compile --jobs 1 --fqbn arduino:renesas_uno:unor4wifi firmware/uno_r4_mqtt_gateway
arduino-cli compile --jobs 1 --fqbn esp32:esp32:XIAO_ESP32C3:CDCOnBoot=default firmware/esp32_mqtt_solar_node
```

Before deployment, verify the AP address and DHCP lease range, node-to-computer reachability and the actual concurrent-station limit. Test all six inputs; reboot broker, node and UNO separately; verify data becomes stale and recovers; verify duplicate node IDs and unsupported power commands produce errors; disconnect Wi-Fi while commanding and check that old commands are not replayed. Measure real latency, Hall accuracy and node power consumption. Wi-Fi/MQTT power consumption must be measured anew; ESP-NOW power results do not transfer to this design.
