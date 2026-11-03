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
int main() {
  try {
    startupTests(); retryTests(); hallTelemetryTests(); commandTests();
    std::cout << "MQTT AP node behavior passed: " << checks << " checks\n";
  } catch (const std::exception &error) {
    std::cerr << "MQTT AP node behavior failed: " << error.what() << "\n";
    return 1;
  }
}
