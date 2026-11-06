#include <iostream>
#include <stdexcept>
#include SOLAR_GATEWAY_SKETCH

static unsigned checks = 0;
void check(bool passed, const char *description) {
  ++checks;
  if (!passed) throw std::runtime_error(description);
}
void reset() {
  Mock::now = 100;
  Mock::wifiStatus = WL_DISCONNECTED; Mock::apResult = WL_AP_LISTENING;
  Mock::apStarts = Mock::stationStarts = Mock::wifiEnds = Mock::configCalls = 0;
  Mock::mqttAttempts = Mock::mqttStops = Mock::mqttPolls = 0;
  Mock::mqttConnectResult = true;
  Mock::beginAPCalls = Mock::modemBegins = Mock::modeWrites = 0;
  Mock::apStations = Mock::apChannel = 0; Mock::apHidden = 99;
  Mock::modemDebugDisabled = false;
  Mock::modeWriteResult = Mock::softApWriteResult = true; Mock::softApResponse = "1";
  Mock::modemCommands.clear();
  Mock::lastApSsid.clear(); Mock::lastBroker.clear(); Mock::published.clear();
  Serial.output.clear(); Serial.input.clear();
  mqtt = MqttClient(network); WiFi = MockWiFi{};
  for (SolarNode &node : nodes) node = SolarNode{};
  session = nextCommand = lastRetry = lastHeartbeat = 0;
  serialLength = 0; serialDiscard = networkAttempted = false;
  apStarted = apAttempted = false; lastApAttempt = 0;
}
std::string lastLine() {
  const size_t end = Serial.output.find_last_not_of("\r\n");
  if (end == std::string::npos) return "{}";
  const size_t start = Serial.output.rfind('\n', end);
  return Serial.output.substr(start == std::string::npos ? 0 : start + 1,
                             end - (start == std::string::npos ? 0 : start + 1) + 1);
}
JsonDocument output() {
  JsonDocument doc;
  check(!deserializeJson(doc, lastLine()), "gateway emits valid JSON");
  return doc;
}
void incoming(const std::string &topic, const std::string &json, bool retained = false) {
  mqtt.topic = topic; mqtt.incoming = json; mqtt.position = 0; mqtt.retained = retained;
  onMqtt(int(json.size()));
}
std::string telemetry(unsigned sequence = 1) {
  return "{\"id\":1,\"boot_id\":12,\"seq\":" + std::to_string(sequence) +
    ",\"uptime_ms\":100,\"hall_mask\":5,\"enabled\":true,\"power_control_available\":false,\"mac\":\"02:00:00:00:00:01\"}";
}
void startTests() {
  reset(); setup();
  check(Mock::apStarts == 1 && Mock::stationStarts == 0, "setup creates its own AP without joining a router");
  check(Mock::beginAPCalls == 0 && Mock::apStations == 9, "AP explicitly requests eight node stations plus the broker PC instead of library default capacity");
  check(Mock::modemDebugDisabled && Mock::modemBegins == 1, "modem startup avoids logging AP credentials");
  check(Mock::modemCommands.size() == 2 && Mock::modemCommands[0] == "AT+WIFIMODE=2\r\n" &&
        Mock::modemCommands[1].find("AT+BEGINSOFTAP=") == 0, "AP-only modem mode precedes explicit-capacity AP startup");
  check(Mock::apChannel == APConfig::CHANNEL && Mock::apHidden == 0, "AP advertises configured visible channel");
  check(Mock::lastApSsid == "HexagonSolar-UNO-R4", "AP uses shared configured SSID");
  check(WiFi.configured == IPAddress(192,168,4,1), "gateway AP has stable configured IP");
  check(apActive(), "listening AP is healthy before any station joins");
  JsonDocument ready = output();
  check(ready["network_mode"] == "access_point" && ready["ap_ip"] == "192.168.4.1", "ready reports AP network and IP");
  check(ready["ap_password"].isUnbound() && ready["password"].isUnbound(), "ready never exposes AP credentials");
  loop();
  check(mqtt.connected() && Mock::lastBroker == "192.168.4.250", "MQTT connects to computer on the AP subnet");
  check(Mock::lastBrokerPort == 1883 && Mock::mqttAttempts == 1, "local MQTT port and first attempt are correct");
  const unsigned starts = Mock::apStarts, stops = Mock::mqttStops;
  Mock::wifiStatus = WL_AP_CONNECTED; Mock::now += 100; loop();
  Mock::wifiStatus = WL_AP_LISTENING; Mock::now += 100; loop();
  check(Mock::apStarts == starts && Mock::mqttStops == stops && mqtt.connected(), "station join/leave transitions do not restart a healthy AP");
  reset(); Mock::apResult = WL_AP_CONNECTED; setup(); loop();
  check(apStarted && mqtt.connected(), "AP startup also accepts connected status");
  reset(); Mock::wifiStatus = WL_NO_MODULE; setup(); loop();
  check(Mock::apStarts == 0 && Mock::stationStarts == 0 && Mock::mqttAttempts == 0, "missing Wi-Fi module cannot start AP or MQTT");
  check(Serial.output.find("wifi_module_missing") != std::string::npos, "missing Wi-Fi module produces explicit error");
  for (const int previousStatus : {WL_AP_LISTENING, WL_AP_CONNECTED}) {
    reset(); Mock::wifiStatus = previousStatus;
    Mock::lastApSsid = "unrelated-old-ap"; WiFi.configured = IPAddress(192,168,99,1);
    setup();
    check(Mock::apStarts == 1 && Mock::wifiEnds == 1 && Mock::lastApSsid == APConfig::SSID,
          "RA4-only reset replaces an inherited AP with the configured system AP");
    check(WiFi.configured == IPAddress(192,168,4,1), "inherited AP address is reset to the system subnet");
    loop();
    check(Mock::apStarts == 1 && mqtt.connected(), "inherited AP recovery settles without repeated restarts");
  }
}
void brokerFailureTests() {
  reset(); Mock::mqttConnectResult = false; setup(); loop();
  check(apActive() && Mock::apStarts == 1 && !mqtt.connected(), "missing broker leaves AP available for the computer to join");
  const unsigned attempts = Mock::mqttAttempts;
  Mock::now += MC::RETRY_MS - 1; loop();
  check(Mock::mqttAttempts == attempts, "broker reconnect has bounded backoff");
  Mock::now += 1; loop();
  check(Mock::mqttAttempts == attempts + 1 && Mock::apStarts == 1, "broker retries never reset AP");
  Mock::mqttConnectResult = true; Mock::now += MC::RETRY_MS; loop();
  check(mqtt.connected() && Mock::apStarts == 1, "broker can become available after AP startup");
}
void lostApTests() {
  reset(); setup(); loop();
  SolarNode &node = nodes[0]; node.seen = node.online = node.pending = true;
  node.boot = 12; node.commandSeq = 1; node.attempts = 1;
  snprintf(node.command, sizeof(node.command), "request_telemetry");
  Mock::wifiStatus = WL_DISCONNECTED; Mock::apResult = WL_AP_FAILED;
  Mock::now += APConfig::RESTART_MS; loop();
  check(!mqtt.connected() && Mock::mqttStops >= 1, "lost AP closes stale MQTT connection");
  check(!node.pending && !node.online, "lost AP cancels commands and invalidates live nodes");
  check(Serial.output.find("access_point_lost") != std::string::npos, "AP loss produces explicit command failure");
  const unsigned starts = Mock::apStarts;
  Mock::now += APConfig::RESTART_MS - 1; loop();
  check(Mock::apStarts == starts, "failed AP startup is not retried every loop");
  Mock::apResult = WL_AP_LISTENING; Mock::now += 1; loop();
  check(apActive() && Mock::apStarts == starts + 1, "AP restarts after backoff");
  check(Mock::stationStarts == 0, "AP recovery never switches to router station mode");
}
void rolloverTests() {
  reset(); Mock::now = UINT32_MAX - 1000; Mock::apResult = WL_AP_FAILED; setup();
  const unsigned starts = Mock::apStarts;
  Mock::now += APConfig::RESTART_MS - 1; serviceAccessPoint(Mock::now);
  check(Mock::apStarts == starts, "AP backoff survives millis rollover before deadline");
  Mock::now += 1; Mock::apResult = WL_AP_LISTENING; serviceAccessPoint(Mock::now);
  check(apActive() && Mock::apStarts == starts + 1, "AP retry runs after millis rollover");
}
void capacityFailureTests() {
  reset(); Mock::modeWriteResult = false; setup(); loop();
  check(!apStarted && Mock::apStarts == 0 && Mock::mqttAttempts == 0,
        "failed AP-only mode selection cannot start a lower-capacity fallback AP");
  check(Mock::beginAPCalls == 0, "mode failure never falls back to WiFi.beginAP");
  for (unsigned failure = 0; failure < 3; ++failure) {
    reset();
    if (failure == 0) Mock::softApWriteResult = false;
    else Mock::softApResponse = failure == 1 ? "0" : "unexpected";
    setup(); loop();
    check(!apStarted && !mqtt.connected() && Mock::mqttAttempts == 0,
          "unconfirmed explicit-capacity AP startup never reports MQTT online");
    check(Mock::beginAPCalls == 0 && Mock::wifiEnds >= 2,
          "rejected AP is stopped without default-capacity fallback");
    const unsigned attempts = Mock::apStarts;
    Mock::now += APConfig::RESTART_MS - 1; loop();
    check(Mock::apStarts == attempts, "capacity rejection observes restart backoff");
    Mock::now += 1; Mock::softApWriteResult = true; Mock::softApResponse = "1"; loop();
    check(apStarted && Mock::apStarts == attempts + 1, "explicit-capacity AP retries after rejection");
  }
}
void telemetryAndAckTests() {
  reset(); setup(); loop();
  const std::string topic = std::string(MC::ROOT) + "/nodes/1/telemetry";
  incoming(topic, telemetry(), true);
  check(!nodes[0].seen, "retained telemetry does not create a live node");
  incoming(std::string(MC::ROOT) + "/nodes/2/telemetry", telemetry());
  check(!nodes[0].seen, "topic/payload node mismatch is rejected");
  incoming(topic, telemetry());
  JsonDocument data = output();
  check(nodes[0].online && data["halls"].size() == 6 && data["halls"][0] == true && data["halls"][1] == false,
        "validated six Hall states pass through AP gateway to console");
  check(data["voltage"].isNull() && data["current"].isNull() && data["power"].isNull() && data["temp"].isNull(),
        "AP path does not invent electrical measurements");
  const size_t published = Mock::published.size();
  incoming(topic, telemetry());
  check(Mock::published.size() == published, "duplicate telemetry is not emitted twice");
  JsonDocument cmd; cmd["cmd"] = "request_telemetry"; cmd["id"] = 1; command(cmd);
  check(nodes[0].pending && nodes[0].attempts == 1, "AP telemetry discovery enables command routing");
  const auto sequence = nodes[0].commandSeq;
  std::string ack = "{\"id\":1,\"gateway_boot_id\":" + std::to_string(session) +
    ",\"node_boot_id\":12,\"sequence\":" + std::to_string(sequence) +
    ",\"cmd\":\"request_telemetry\",\"success\":true}";
  incoming(std::string(MC::ROOT) + "/nodes/1/ack", ack, true);
  check(nodes[0].pending, "retained ACK cannot complete a live command");
  incoming(std::string(MC::ROOT) + "/nodes/1/ack", ack);
  check(!nodes[0].pending && output()["success"] == true, "correlated live ACK completes command");
}
void eightNodeTests() {
  reset(); setup(); loop();
  for (unsigned id = 1; id <= 8; ++id) {
    JsonDocument doc;
    doc["id"] = id; doc["boot_id"] = 100 + id; doc["seq"] = 1;
    doc["uptime_ms"] = 100; doc["hall_mask"] = id;
    doc["enabled"] = true; doc["power_control_available"] = false;
    char mac[18]; snprintf(mac, sizeof(mac), "02:00:00:00:00:%02u", id); doc["mac"] = mac;
    std::string json; serializeJson(doc, json);
    incoming(std::string(MC::ROOT) + "/nodes/" + std::to_string(id) + "/telemetry", json);
    check(nodes[id-1].online && nodes[id-1].boot == 100+id, "all eight node IDs have independent live telemetry state");
  }
  JsonDocument cmd; cmd["cmd"] = "request_telemetry"; command(cmd);
  JsonDocument wrongAck;
  wrongAck["id"] = 2; wrongAck["gateway_boot_id"] = session; wrongAck["node_boot_id"] = 102;
  wrongAck["sequence"] = nodes[0].commandSeq; wrongAck["cmd"] = "request_telemetry"; wrongAck["success"] = true;
  std::string wrongJson; serializeJson(wrongAck, wrongJson);
  incoming(std::string(MC::ROOT) + "/nodes/2/ack", wrongJson);
  check(nodes[0].pending && nodes[1].pending, "one node's command sequence cannot complete another node's pending command");
  for (unsigned id = 1; id <= 8; ++id) {
    check(nodes[id-1].pending && nodes[id-1].attempts == 1, "broadcast telemetry request routes independently to every discovered node");
    JsonDocument ack;
    ack["id"] = id; ack["gateway_boot_id"] = session; ack["node_boot_id"] = 100+id;
    ack["sequence"] = nodes[id-1].commandSeq; ack["cmd"] = "request_telemetry"; ack["success"] = true;
    std::string json; serializeJson(ack, json);
    incoming(std::string(MC::ROOT) + "/nodes/" + std::to_string(id) + "/ack", json);
    check(!nodes[id-1].pending, "each of eight nodes completes only its correlated command");
  }
  check(Mock::apStations == 9 && Mock::beginAPCalls == 0, "eight-node application test retains requested nine-station AP configuration");
}
JsonDocument identityTelemetry(unsigned sequence = 1) {
  JsonDocument doc;
  deserializeJson(doc, telemetry(sequence));
  doc["neighbor_detection"] = "ready";
  JsonArray peers = doc["edge_neighbors"].to<JsonArray>();
  for (unsigned i = 0; i < 6; ++i) peers.add(nullptr);
  JsonObject peer = peers[0].to<JsonObject>();
  peer["id"] = 2; peer["side"] = 3; peer["boot_id"] = 23;
  peer["mac"] = "02:00:00:AA:00:02"; peer["age_ms"] = 10;
  return doc;
}
void edgeIdentityTests() {
  reset(); setup(); loop();
  const std::string topic = std::string(MC::ROOT) + "/nodes/1/telemetry";
  auto receive = [&](const JsonDocument &doc) {
    std::string json; serializeJson(doc, json); incoming(topic, json);
  };
  incoming(topic, telemetry());
  JsonDocument legacy = output();
  check(legacy["neighbor_detection"] == "disabled" && legacy["edge_neighbors"].size() == 6,
        "legacy Hall-only packets explicitly report identity detection disabled");
  for (unsigned side = 0; side < 6; ++side)
    check(legacy["edge_neighbors"][side].isNull(), "Hall presence alone never creates a neighbor claim");
  JsonDocument valid = identityTelemetry(2); receive(valid);
  JsonDocument forwarded = output();
  check(nodes[0].seq == 2 && forwarded["edge_neighbors"][0]["id"] == 2 &&
        forwarded["edge_neighbors"][0]["side"] == 3 && forwarded["edge_neighbors"][0]["boot_id"] == 23,
        "edge-local identity is preserved for reciprocal verification by the console");
  check(forwarded["edge_neighbors"][0]["age_ms"] == 10 && forwarded["edge_neighbors"][1].isNull(),
        "identity age and unknown directions remain explicit");
  auto reject = [&](const JsonDocument &doc, const char *description) {
    const auto seq = nodes[0].seq, lastSeen = nodes[0].lastSeen;
    const size_t count = Mock::published.size();
    Mock::now += 1; receive(doc);
    check(nodes[0].seq == seq && nodes[0].lastSeen == lastSeen && Mock::published.size() == count, description);
  };
  JsonDocument bad = identityTelemetry(3); bad.remove("neighbor_detection");
  reject(bad, "neighbor list without hardware state cannot refresh node state");
  bad = identityTelemetry(3); bad.remove("edge_neighbors");
  reject(bad, "hardware state without neighbor list is rejected");
  bad = identityTelemetry(3); bad["neighbor_detection"] = nullptr;
  reject(bad, "null hardware state is not legacy telemetry");
  bad = identityTelemetry(3); bad["neighbor_detection"] = "guessed";
  reject(bad, "unknown hardware state is rejected");
  for (const char *state : {"disabled", "hardware_error"}) {
    bad = identityTelemetry(3); bad["neighbor_detection"] = state;
    reject(bad, "unavailable hardware cannot claim a physical neighbor");
  }
  bad = identityTelemetry(3); bad["edge_neighbors"].remove(5);
  reject(bad, "neighbor list must cover exactly six directions");
  bad = identityTelemetry(3); bad["edge_neighbors"][1] = true;
  reject(bad, "non-null neighbor entries must be objects");
  bad = identityTelemetry(3); bad["hall_mask"] = 4;
  reject(bad, "clear local Hall direction cannot carry an identity claim");
  for (const int id : {0, 1, 9}) {
    bad = identityTelemetry(3); bad["edge_neighbors"][0]["id"] = id;
    reject(bad, "neighbor IDs must be a different legal module ID");
  }
  for (const char *field : {"id", "side", "boot_id", "age_ms"}) {
    bad = identityTelemetry(3); bad["edge_neighbors"][0][field] = true;
    reject(bad, "neighbor integer fields cannot be JSON booleans");
  }
  bad = identityTelemetry(3); bad["edge_neighbors"][0]["side"] = 6;
  reject(bad, "neighbor side must be between zero and five");
  bad = identityTelemetry(3); bad["edge_neighbors"][0]["boot_id"] = 0;
  reject(bad, "zero neighbor boot session is rejected");
  bad = identityTelemetry(3); bad["edge_neighbors"][0]["age_ms"] = 3000;
  reject(bad, "expired edge identity cannot be forwarded as a fresh claim");
  bad = identityTelemetry(3); bad["edge_neighbors"][0]["age_ms"] = -1;
  reject(bad, "negative edge age is rejected");
  for (const char *mac : {"02:00:00:00:00:01", "FF:FF:FF:FF:FF:FF", "01:00:00:00:00:02",
                          "00:00:00:00:00:00", "02:00:00:XX:00:02", "02-00-00-AA-00-02"}) {
    bad = identityTelemetry(3); bad["edge_neighbors"][0]["mac"] = mac;
    reject(bad, "self, multicast, zero and malformed peer MACs are rejected");
  }
  bad = identityTelemetry(3); bad["edge_neighbors"][2] = bad["edge_neighbors"][0];
  reject(bad, "two local sides cannot reuse the same peer endpoint");
  bad = identityTelemetry(3); bad["edge_neighbors"][2] = bad["edge_neighbors"][0];
  bad["edge_neighbors"][2]["side"] = 4;
  reject(bad, "two rigid hexagonal modules cannot share multiple local sides");
  bad = identityTelemetry(3); bad["edge_neighbors"][2] = bad["edge_neighbors"][0];
  bad["edge_neighbors"][2]["id"] = 3;
  reject(bad, "one physical peer MAC cannot appear under two module IDs");
  bad = identityTelemetry(3); bad["boot_id"] = 0;
  reject(bad, "zero reporting boot session is rejected");
  bad = identityTelemetry(3); bad["mac"] = "02:00:00:00:ZZ:01";
  reject(bad, "malformed reporting MAC cannot establish node identity");
  bad = identityTelemetry(3);
  bad["padding"] = std::string(MC::MAX_FRAME - measureJson(bad) - 50, 'x');
  check(measureJson(bad) <= MC::MAX_FRAME, "oversized normalized event fixture fits the inbound frame limit");
  reject(bad, "normalization cannot advance state when the emitted event would exceed its frame limit");

  JsonDocument six = identityTelemetry(3); six["hall_mask"] = 63;
  six["uptime_ms"] = UINT32_MAX; six["q"] = -128; six["r"] = 127;
  for (unsigned side = 0; side < 6; ++side) {
    JsonObject peer = six["edge_neighbors"][side].to<JsonObject>();
    peer["id"] = side + 2; peer["side"] = 5-side; peer["boot_id"] = UINT32_MAX;
    char mac[18]; snprintf(mac, sizeof(mac), "02:00:00:AA:00:%02u", side+2);
    peer["mac"] = mac; peer["age_ms"] = 2999;
  }
  receive(six); JsonDocument complete = output();
  check(nodes[0].seq == 3 && complete["edge_neighbors"].size() == 6 &&
        complete["edge_neighbors"][5]["id"] == 7, "all six independent hardware directions survive forwarding");
  check(measureJson(complete) <= MC::MAX_FRAME && Mock::published.back().payload.size() == measureJson(complete),
        "complete six-neighbor JSON fits and reaches MQTT without truncation");
  valid = identityTelemetry(4); valid["mac"] = "02:00:00:00:00:01";
  valid["edge_neighbors"][0]["mac"] = "02:00:00:aa:00:02"; receive(valid);
  check(output()["edge_neighbors"][0]["mac"] == "02:00:00:AA:00:02", "MAC casing is normalized for exact reciprocal comparisons");
  valid = identityTelemetry(5); valid["neighbor_detection"] = "hardware_error";
  for (unsigned side = 0; side < 6; ++side) valid["edge_neighbors"][side] = nullptr;
  receive(valid);
  check(output()["neighbor_detection"] == "hardware_error" && nodes[0].seq == 5,
        "hardware failures remain explicit without keeping a prior neighbor identity");
}
int main() {
  try {
#if defined(SOLAR_TEST_INVALID_CAPACITY)
    reset(); setup(); loop();
    check(!apStarted && Mock::apStarts == 0 && Mock::beginAPCalls == 0, "invalid station limit cannot start a smaller fallback AP");
    check(Mock::mqttAttempts == 0, "invalid station limit prevents MQTT from starting");
    check(Serial.output.find("invalid_ap_station_limit") != std::string::npos, "invalid station limit is reported");
#elif defined(SOLAR_TEST_TEN_STATIONS)
    reset(); setup(); loop();
    check(apStarted && mqtt.connected() && Mock::apStations == 10, "legal ten-station configuration reserves an extra phone slot");
    check(Mock::beginAPCalls == 0, "ten-station configuration uses explicit-capacity startup");
#elif defined(SOLAR_TEST_MAX_CREDENTIALS)
    reset(); setup(); loop();
    check(apStarted && mqtt.connected(), "maximum legal SSID and password start the configured AP");
    check(strlen(APConfig::SSID) == 32 && strlen(APConfig::PASSWORD) == 63, "test exercises maximum legal credential lengths");
    check(Mock::modemCommands.size() == 2 && Mock::modemCommands.back().size() < MAX_BUFF_SIZE,
          "maximum credential command fits the modem's 128-byte formatting buffer");
    check(Mock::apStations == 9 && Mock::beginAPCalls == 0, "maximum credentials preserve explicit station capacity");
#elif defined(SOLAR_TEST_INVALID_AP)
    reset(); setup(); loop();
    check(!apStarted && Mock::apStarts == 0 && Mock::stationStarts == 0, "invalid AP password never starts an open or fallback network");
    check(Mock::mqttAttempts == 0, "invalid AP credentials prevent MQTT connection");
    check(Serial.output.find("invalid_ap_credentials") != std::string::npos, "invalid AP credentials are reported");
    Mock::now += APConfig::RESTART_MS; loop();
    check(Mock::apStarts == 0, "AP retries do not bypass credential validation");
#else
    startTests(); brokerFailureTests(); lostApTests(); rolloverTests(); capacityFailureTests(); telemetryAndAckTests(); eightNodeTests(); edgeIdentityTests();
#endif
    std::cout << "MQTT AP gateway behavior passed: " << checks << " checks\n";
  } catch (const std::exception &error) {
    std::cerr << "MQTT AP gateway behavior failed: " << error.what() << "\n";
    return 1;
  }
}
