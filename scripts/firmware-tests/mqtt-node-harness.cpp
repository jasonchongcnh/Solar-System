#include <iostream>
#include <stdexcept>
#include SOLAR_NODE_SKETCH

static unsigned checks = 0;
void check(bool passed, const char *description) {
  ++checks;
  if (!passed) throw std::runtime_error(description);
}
void reset() {
  Mock::now = 100; Mock::wifiStatus = WL_DISCONNECTED;
  Mock::stationStarts = Mock::apStarts = Mock::mqttAttempts = Mock::mqttStops = 0;
  Mock::mqttConnectResult = true; Mock::disconnects = 0;
  Mock::persistent = Mock::autoReconnect = true; Mock::stationMode = 0;
  Mock::beginAPCalls = Mock::modemBegins = Mock::modeWrites = 0;
  Mock::apStations = Mock::apHidden = Mock::apChannel = 0;
  Mock::modemDebugDisabled = false;
  Mock::modeWriteResult = Mock::softApWriteResult = true;
  Mock::softApResponse = "1"; Mock::modemCommands.clear();
  Mock::lastStationSsid.clear(); Mock::lastStationPassword.clear(); Mock::lastBroker.clear();
  Mock::published.clear();
  for (unsigned i = 0; i < 40; ++i) {
    Mock::gpioLevels[i] = HIGH;
    Mock::gpioModes[i] = Mock::gpioReads[i] = Mock::gpioWrites[i] = 0;
  }
  mqtt = MqttClient(network); WiFi = MockWiFi{};
  Serial.output.clear(); Serial.input.clear();
  nodeId = NodeConfig::MANUAL_NODE_ID; configBits = 255; hallMask = 0;
  bootId = sequence = lastPublish = lastRetry = lastGateway = lastCommand = 0;
  enabled = NodeConfig::POWER_RELAY_PIN < 0;
  ready = attempted = lastResult = lastEnabled = false; dirty = true;
  memset(lastCommandName, 0, sizeof(lastCommandName));
  for (HallInput &input : halls) input = HallInput{false, false, 0};
  MockWire::reset();
  for (EdgeIdentity::Port &port : edgePorts) port = EdgeIdentity::Port{};
  memset(edgeLocalMac, 0, sizeof(edgeLocalMac)); edgeContactMask = 0;
  edgeHardwareReady = edgeWireReady = edgeAttempted = edgeServiced = false;
  lastEdgeService = lastEdgeRetry = 0;
  if (NodeConfig::EDGE_IDENTITY_ENABLED)
    for (uint8_t address : NodeConfig::EDGE_UART_ADDRESSES) MockWire::chips[address].present = true;
}
JsonDocument lastTelemetry() {
  for (auto it = Mock::published.rbegin(); it != Mock::published.rend(); ++it) {
    if (it->topic == telemetryTopic) {
      JsonDocument doc;
      check(!deserializeJson(doc, it->payload), "node emits valid telemetry JSON");
      return doc;
    }
  }
  throw std::runtime_error("node did not publish telemetry");
}
size_t telemetryCount() {
  size_t count = 0;
  for (const auto &publication : Mock::published) if (publication.topic == telemetryTopic) ++count;
  return count;
}
void startupTests() {
  reset(); setup();
  check(ready && Mock::disconnects == 1, "node clears any old station association before joining AP");
  check(!Mock::persistent && !Mock::autoReconnect && Mock::stationMode == WIFI_STA,
        "node disables stored-network reconnect and explicitly uses station mode");
  loop();
  check(Mock::stationStarts == 1 && Mock::lastStationSsid == APConfig::SSID && Mock::lastStationPassword == APConfig::PASSWORD,
        "XIAO joins configured UNO AP with its password");
  check(Mock::lastStationSsid != SOLAR_WIFI_SSID && Mock::lastStationPassword != SOLAR_WIFI_PASSWORD,
        "legacy router credentials are ignored");
  check(mqtt.connected() && Mock::lastBroker == "192.168.4.250" && Mock::lastBroker != SOLAR_MQTT_HOST,
        "node uses broker on UNO AP subnet instead of legacy MQTT host");
  check(Mock::apStarts == 0, "XIAO does not create a second AP");
  for (uint8_t pin : NodeConfig::HARDWARE_ID_PINS)
    check(Mock::gpioModes[pin] == 0 && Mock::gpioReads[pin] == 0 && Mock::gpioWrites[pin] == 0,
          "manual node ID mode leaves D6-D8 untouched");
  for (uint8_t pin : NodeConfig::HALL_PINS) check(Mock::gpioModes[pin] == 1, "each of six Hall inputs is configured");
  check(MockWire::beginCalls == (NodeConfig::EDGE_IDENTITY_ENABLED ? 1U : 0U), "edge I2C starts only when explicitly enabled");
}
void retryTests() {
  reset(); Mock::mqttConnectResult = false; setup(); loop();
  check(Mock::stationStarts == 1 && Mock::mqttAttempts == 1 && !mqtt.connected(), "node joins AP even if broker is unavailable");
  Mock::now += MC::RETRY_MS - 1; loop();
  check(Mock::mqttAttempts == 1, "node MQTT reconnect obeys backoff");
  Mock::now += 1; loop();
  check(Mock::mqttAttempts == 2 && Mock::stationStarts == 1, "broker retries do not rejoin healthy AP");
  Mock::mqttConnectResult = true; Mock::now += MC::RETRY_MS; loop();
  check(mqtt.connected() && Mock::stationStarts == 1, "node recovers when AP-local broker starts");
  mqtt.live = false; Mock::wifiStatus = WL_DISCONNECTED; Mock::now += MC::RETRY_MS; loop();
  check(Mock::stationStarts == 2 && Mock::lastStationSsid == APConfig::SSID, "lost AP connection rejoins the UNO AP");
}
void hallTelemetryTests() {
  reset(); setup(); loop();
  JsonDocument first = lastTelemetry();
  check(first["neighbor_detection"] == (NodeConfig::EDGE_IDENTITY_ENABLED ? "ready" : "disabled") &&
        first["edge_neighbors"].size() == 6 && first["edge_neighbors"][0].isNull(), "unpaired edges never invent module IDs");
  check(first["hall_mask"] == 0 && first["config_bits"].isNull(), "initial six inputs are clear and ID source is manual");
  check(first["power_control_available"] == false && first["enabled"] == true, "Hall-only node does not claim relay control");
  check(first["voltage"].isUnbound() && first["current"].isUnbound() && first["power"].isUnbound() && first["temp"].isUnbound(),
        "node does not invent unavailable electrical or temperature measurements");
  const size_t initialCount = telemetryCount();
  const uint32_t firstSeq = first["seq"];
  for (unsigned i = 0; i < 6; ++i) {
    Mock::gpioLevels[NodeConfig::HALL_PINS[i]] = LOW;
    readHalls();
    check((hallMask & (1U << i)) == 0, "Hall change must survive debounce");
    Mock::now += NodeConfig::HALL_DEBOUNCE_MS; readHalls();
    check((hallMask & (1U << i)) != 0, "each Hall direction maps to the corresponding mask bit");
  }
  Mock::now += NodeConfig::CHANGE_MIN_INTERVAL_MS; loop();
  JsonDocument active = lastTelemetry();
  check(active["hall_mask"] == 63 && active["seq"].as<uint32_t>() > firstSeq, "changed six-Hall state publishes a newer sequence");
  check(active["mac"] == "02:00:00:00:00:01" && active["rssi"] == -61, "telemetry includes actual mocked AP link metadata");
  check(telemetryCount() == initialCount + 1, "debounced changes are coalesced into one publication");
  const size_t afterChange = telemetryCount();
  Mock::now += NodeConfig::TELEMETRY_PERIOD_MS; loop();
  check(telemetryCount() == afterChange + 1, "periodic telemetry continues without Hall changes");
}
std::string makeCommand(uint32_t seq, uint32_t expiry, uint32_t boot = 99) {
  JsonDocument doc;
  doc["id"] = nodeId; doc["node_boot_id"] = boot; doc["gateway_boot_id"] = 17;
  doc["sequence"] = seq; doc["expires_uptime_ms"] = expiry; doc["cmd"] = "request_telemetry";
  std::string json; serializeJson(doc, json); return json;
}
void incoming(const std::string &json, bool retained = false) {
  mqtt.topic = commandTopic; mqtt.incoming = json; mqtt.position = 0; mqtt.retained = retained;
  onMqtt(int(json.size()));
}
void commandTests() {
  reset(); setup(); loop(); dirty = false;
  const size_t count = Mock::published.size();
  incoming(makeCommand(1, Mock::now + 5000), true);
  check(Mock::published.size() == count && !dirty, "retained commands cannot execute on AP node");
  incoming(makeCommand(1, Mock::now - 1));
  check(Mock::published.size() == count && !dirty, "expired commands cannot execute");
  incoming(makeCommand(1, Mock::now + 5000, bootId + 1));
  check(Mock::published.size() == count && !dirty, "commands for an older node boot are ignored");
  incoming(makeCommand(2, Mock::now + 5000));
  check(dirty && Mock::published.back().topic == ackTopic, "valid live command requests telemetry and sends application ACK");
  dirty = false; const size_t applied = Mock::published.size();
  incoming(makeCommand(1, Mock::now + 5000));
  check(!dirty && Mock::published.size() == applied, "stale command sequence cannot execute");
  incoming(makeCommand(2, Mock::now + 5000));
  check(!dirty && Mock::published.size() == applied + 1, "duplicate command resends ACK without reapplying request");
}
EdgeIdentity::Frame edgeFrame(unsigned id = 2, unsigned side = 3, uint32_t seq = 1) {
  EdgeIdentity::Frame frame; frame.id = uint8_t(id); frame.side = uint8_t(side);
  frame.boot = 700 + id; frame.challenge = 900 + id; frame.sequence = seq;
  const uint8_t mac[6] = {2, 0, 0, 0, 0, uint8_t(id)}; memcpy(frame.mac, mac, 6);
  return frame;
}
void injectEdge(unsigned side, const EdgeIdentity::Frame &frame, bool corrupt = false) {
  uint8_t bytes[EdgeIdentity::FRAME_SIZE]; EdgeIdentity::encode(frame, bytes);
  if (corrupt) bytes[20] ^= 1;
  auto &rx = MockWire::chips[NodeConfig::EDGE_UART_ADDRESSES[side / 2]].rx[side % 2];
  rx.insert(rx.end(), bytes, bytes + sizeof(bytes));
}
void attachAllEdges() {
  for (uint8_t pin : NodeConfig::HALL_PINS) Mock::gpioLevels[pin] = LOW;
  readHalls(); Mock::now += NodeConfig::HALL_DEBOUNCE_MS; readHalls(); serviceEdgeIdentities();
}
void handshake(unsigned side, unsigned id) {
  EdgeIdentity::Frame frame = edgeFrame(id, (side + 3) % 6);
  injectEdge(side, frame); ++Mock::now; serviceEdgeIdentities();
  check(edgePorts[side].candidate && !edgePorts[side].confirmed, "a one-way hello is not a neighbor claim");
  frame.sequence = 2; frame.echo = edgePorts[side].challenge;
  injectEdge(side, frame); ++Mock::now; serviceEdgeIdentities();
  check(edgePorts[side].confirmed, "fresh echoed edge challenge confirms the attached peer");
}
void edgeTests() {
  if (!NodeConfig::EDGE_IDENTITY_ENABLED) return;
  reset(); setup(); loop(); attachAllEdges(); handshake(0, 2);
  check(MockWire::sda == D9 && MockWire::scl == D10 && MockWire::clock == 400000 && MockWire::timeout == 10,
        "edge UARTs use explicit free pins and bounded I2C timeout");
  check(telemetry(), "confirmed neighbor telemetry publishes");
  JsonDocument report = lastTelemetry();
  check(report["edge_neighbors"][0]["id"] == 2 && report["edge_neighbors"][0]["side"] == 3 &&
        report["edge_neighbors"][0]["mac"] == "02:00:00:00:00:02", "telemetry preserves edge-local neighbor identity");
  const uint32_t seen = edgePorts[0].lastSeen;
  auto replay = edgeFrame(2, 3, 2); replay.echo = edgePorts[0].challenge;
  injectEdge(0, replay); ++Mock::now; serviceEdgeIdentities();
  check(edgePorts[0].lastSeen == seen, "duplicate frame does not extend a claim");
  replay.sequence = 3; injectEdge(0, replay, true); ++Mock::now; serviceEdgeIdentities();
  check(edgePorts[0].lastSeen == seen, "corrupt UART data does not refresh a claim");
  Mock::gpioLevels[NodeConfig::HALL_PINS[0]] = HIGH; ++Mock::now; serviceEdgeIdentities();
  check(!edgePorts[0].confirmed && (hallMask & 1), "raw Hall detach revokes identity before debounce finishes");
  attachAllEdges(); handshake(0, 2);
  replay.echo = edgePorts[0].challenge; injectEdge(0, replay);
  Mock::now += NodeConfig::EDGE_MAX_SERVICE_GAP_MS; serviceEdgeIdentities();
  check(!edgePorts[0].confirmed && MockWire::chips[0x48].rx[0].empty(), "service stall rotates challenge and flushes queued UART data");
  handshake(0, 2);
  for (unsigned i = 0; i < 31; ++i) { Mock::now += 100; serviceEdgeIdentities(); }
  check(!edgePorts[0].confirmed, "silent peer expires even while service remains healthy");
  handshake(0, 2); MockWire::chips[0x48].present = false; ++Mock::now; serviceEdgeIdentities();
  check(!edgeHardwareReady && !edgePorts[0].confirmed, "chip failure immediately revokes all claims");
  MockWire::chips[0x48].present = true; Mock::now += NodeConfig::EDGE_RETRY_MS; serviceEdgeIdentities();
  check(edgeHardwareReady && !edgePorts[0].confirmed, "recovered UART hardware requires a new handshake");
  for (unsigned side = 0; side < 6; ++side) handshake(side, side + 2);
  check(telemetry(), "all six populated neighbor identities fit the MQTT frame");
  report = lastTelemetry();
  check(measureJson(report) <= MC::MAX_FRAME && report["edge_neighbors"][5]["id"] == 7, "six-edge JSON is complete and bounded");
  // A duplicate configured node ID on a different edge must not appear valid.
  edgePorts[1].peer.id = edgePorts[2].peer.id = edgePorts[0].peer.id; ++Mock::now; serviceEdgeIdentities();
  check(!edgePorts[0].confirmed && !edgePorts[1].confirmed && !edgePorts[2].confirmed,
        "all three duplicate IDs are revoked before any conflict endpoint is cleared");
  reset(); setup(); loop(); attachAllEdges();
  for (unsigned side = 0; side < 3; ++side) handshake(side, side + 2);
  edgePorts[1].peer.id = edgePorts[0].peer.id;
  memcpy(edgePorts[1].peer.mac, edgePorts[2].peer.mac, 6); ++Mock::now; serviceEdgeIdentities();
  check(!edgePorts[0].confirmed && !edgePorts[1].confirmed && !edgePorts[2].confirmed,
        "ID and MAC collision chains revoke every involved edge");
}
int main() {
  try {
#if SOLAR_TEST_EDGE_PIN_CONFLICT
    reset(); check(!validPins(), "I2C pin overlapping a Hall input is rejected"); setup();
    check(!ready && MockWire::beginCalls == 0, "invalid edge pins do not start I2C or MQTT");
#else
    startupTests(); retryTests(); hallTelemetryTests(); commandTests(); edgeTests();
#endif
    std::cout << "MQTT AP node behavior passed: " << checks << " checks\n";
  } catch (const std::exception &error) {
    std::cerr << "MQTT AP node behavior failed: " << error.what() << "\n";
    return 1;
  }
}
