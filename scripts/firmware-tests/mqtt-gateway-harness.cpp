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
    startTests(); brokerFailureTests(); lostApTests(); rolloverTests(); capacityFailureTests(); telemetryAndAckTests(); eightNodeTests();
#endif
    std::cout << "MQTT AP gateway behavior passed: " << checks << " checks\n";
  } catch (const std::exception &error) {
    std::cerr << "MQTT AP gateway behavior failed: " << error.what() << "\n";
    return 1;
  }
}
