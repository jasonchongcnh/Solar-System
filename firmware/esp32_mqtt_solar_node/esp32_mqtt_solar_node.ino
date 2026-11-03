/* Six Hall inputs -> UNO R4 access point -> PC MQTT broker -> UNO gateway.
 * Select the actual board; configure NodeConfig.h and AccessPointSecrets.h.
 */
#include <WiFi.h>
#include <esp_system.h>
#include <driver/gpio.h>
#include "MqttSupport.h"
#include "NodeConfig.h"
#include "AccessPointConfig.h"
#if (defined(CONFIG_IDF_TARGET_ESP32C3) || defined(CONFIG_IDF_TARGET_ESP32S3) || defined(CONFIG_IDF_TARGET_ESP32C6)) && !ARDUINO_USB_CDC_ON_BOOT
#error "Enable USB CDC On Boot: UART0 logging may drive wired D6/D7."
#endif
WiFiClient network;
MqttClient mqtt(network);
struct HallInput { bool stable, candidate; uint32_t changed; };
HallInput halls[6];
unsigned nodeId = NodeConfig::MANUAL_NODE_ID, configBits = 255;
uint8_t hallMask = 0;
uint32_t bootId, sequence = 0, lastPublish = 0, lastRetry = 0;
uint32_t lastGateway = 0, lastCommand = 0;
bool enabled = NodeConfig::POWER_RELAY_PIN < 0, ready = false, attempted = false, dirty = true;
char telemetryTopic[96], commandTopic[96], ackTopic[96], statusTopic[96], clientId[48];
char lastCommandName[24] = {};
bool lastResult = false, lastEnabled = false;

bool validPins() {
  uint8_t pins[9]; memcpy(pins, NodeConfig::HALL_PINS, 6); memcpy(pins+6, NodeConfig::HARDWARE_ID_PINS, 3);
  if (NodeConfig::MANUAL_NODE_ID < 1 || NodeConfig::MANUAL_NODE_ID > MC::MAX_NODES) return false;
  for (unsigned i = 0; i < 9; ++i) {
    if (!GPIO_IS_VALID_GPIO(pins[i]) || pins[i] == NodeConfig::POWER_RELAY_PIN) return false;
#if !ARDUINO_USB_CDC_ON_BOOT
    if (pins[i] == TX || pins[i] == RX) return false;
#endif
    for (unsigned j = i+1; j < 9; ++j) if (pins[i] == pins[j]) return false;
  }
  return NodeConfig::POWER_RELAY_PIN == -1 || GPIO_IS_VALID_OUTPUT_GPIO(NodeConfig::POWER_RELAY_PIN);
}
bool configureId() {
  if (!NodeConfig::USE_HARDWARE_ID) return true;
  for (uint8_t pin : NodeConfig::HARDWARE_ID_PINS) pinMode(pin, NodeConfig::ID_USE_PULLUP ? INPUT_PULLUP : INPUT);
  const uint32_t start = millis(); uint32_t stableAt = start; unsigned previous = 255;
  while (millis() - start < NodeConfig::ID_TIMEOUT_MS) {
    unsigned bits = 0;
    for (unsigned i = 0; i < 3; ++i) if (digitalRead(NodeConfig::HARDWARE_ID_PINS[i]) == LOW) bits |= 1U << i;
    if (bits != previous) { previous = bits; stableAt = millis(); }
    else if (millis() - stableAt >= NodeConfig::ID_STABLE_MS) { configBits = bits; nodeId = 1+bits; return true; }
    delay(1);
  }
  return false;
}
void readHalls() {
  const uint32_t now = millis();
  for (unsigned i = 0; i < 6; ++i) {
    const bool active = (digitalRead(NodeConfig::HALL_PINS[i]) == LOW) == NodeConfig::HALL_ACTIVE_LOW;
    HallInput &input = halls[i];
    if (active != input.candidate) { input.candidate = active; input.changed = now; }
    if (input.stable != input.candidate && now - input.changed >= NodeConfig::HALL_DEBOUNCE_MS) {
      input.stable = input.candidate;
      if (input.stable) hallMask |= 1U << i; else hallMask &= ~(1U << i);
      dirty = true;
    }
  }
}
bool telemetry() {
  JsonDocument doc; doc["type"] = "telemetry"; doc["id"] = nodeId;
  doc["boot_id"] = bootId; doc["seq"] = ++sequence; doc["hall_mask"] = hallMask;
  doc["uptime_ms"] = millis(); doc["uptime"] = millis() / 1000;
  doc["enabled"] = enabled; doc["power_control_available"] = NodeConfig::POWER_RELAY_PIN >= 0;
  if (configBits == 255) doc["config_bits"] = nullptr; else doc["config_bits"] = configBits;
  static const int8_t coords[8][2] = {{0,0},{1,0},{0,1},{-1,1},{-1,0},{0,-1},{1,-1},{2,-1}};
  doc["q"] = NodeConfig::USE_CUSTOM_COORDINATES ? NodeConfig::COORD_Q : coords[nodeId-1][0];
  doc["r"] = NodeConfig::USE_CUSTOM_COORDINATES ? NodeConfig::COORD_R : coords[nodeId-1][1];
  doc["mac"] = WiFi.macAddress(); doc["rssi"] = WiFi.RSSI(); // UNO AP signal, not ESP-NOW.
  return solarPublish(mqtt, telemetryTopic, doc);
}
void acknowledge(uint32_t gateway, uint32_t seq, const char *cmd, bool success) {
  JsonDocument doc; doc["id"] = nodeId; doc["node_boot_id"] = bootId;
  doc["gateway_boot_id"] = gateway; doc["sequence"] = seq; doc["cmd"] = cmd;
  doc["success"] = success; doc["enabled"] = enabled;
  solarPublish(mqtt, ackTopic, doc);
}
void onMqtt(int size) {
  const String topic = mqtt.messageTopic();
  JsonDocument doc;
  if (!solarRead(mqtt, size, doc) || topic != commandTopic || !solarId(doc["id"]) ||
      doc["id"].as<unsigned>() != nodeId || !solarUInt(doc["node_boot_id"]) ||
      doc["node_boot_id"].as<uint32_t>() != bootId || !solarUInt(doc["gateway_boot_id"]) ||
      !solarUInt(doc["sequence"]) || !solarUInt(doc["expires_uptime_ms"]) || !doc["cmd"].is<const char *>()) return;
  const uint32_t expiry = doc["expires_uptime_ms"];
  const int32_t remaining = int32_t(expiry - millis());
  if (remaining <= 0 || remaining > 10000) return;
  const uint32_t gateway = doc["gateway_boot_id"], seq = doc["sequence"];
  const char *cmd = doc["cmd"];
  const bool desired = doc["enabled"] | false;
  if (gateway == lastGateway && seq == lastCommand) {
    if (!strcmp(cmd, lastCommandName) && desired == lastEnabled) acknowledge(gateway, seq, cmd, lastResult);
    return;
  }
  if (gateway == lastGateway && !solarNewer(seq, lastCommand)) return;
  bool success = false;
  if (!strcmp(cmd, "request_telemetry")) { dirty = true; success = true; }
  else if (!strcmp(cmd, "set_power") && doc["enabled"].is<bool>() && NodeConfig::POWER_RELAY_PIN >= 0) {
    enabled = desired;
    digitalWrite(NodeConfig::POWER_RELAY_PIN, enabled == NodeConfig::RELAY_ACTIVE_HIGH ? HIGH : LOW);
    dirty = true; success = true;
  }
  lastGateway = gateway; lastCommand = seq; lastResult = success; lastEnabled = desired;
  snprintf(lastCommandName, sizeof(lastCommandName), "%s", cmd);
  acknowledge(gateway, seq, cmd, success);
}
void setup() {
  Serial.begin(115200);
  if (!APConfig::credentialsValid()) {
    Serial.println("Invalid AP credentials; MQTT disabled."); return;
  }
  if (!validPins()) { Serial.println("Invalid pins/ID; MQTT disabled."); return; }
  if (NodeConfig::POWER_RELAY_PIN >= 0) {
    digitalWrite(NodeConfig::POWER_RELAY_PIN, NodeConfig::RELAY_ACTIVE_HIGH ? LOW : HIGH);
    pinMode(NodeConfig::POWER_RELAY_PIN, OUTPUT);
  }
  if (!configureId()) { Serial.println("Unstable hardware ID; MQTT disabled."); return; }
  for (unsigned i = 0; i < 6; ++i) {
    pinMode(NodeConfig::HALL_PINS[i], NodeConfig::HALL_USE_PULLUP ? INPUT_PULLUP : INPUT);
    const bool active = (digitalRead(NodeConfig::HALL_PINS[i]) == LOW) == NodeConfig::HALL_ACTIVE_LOW;
    halls[i] = {active, active, millis()}; if (active) hallMask |= 1U << i;
  }
  do { bootId = esp_random(); } while (!bootId);
  WiFi.persistent(false); WiFi.setAutoReconnect(false); WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false); // Drop any old station association; keep NVS untouched.
  solarTopic(telemetryTopic, sizeof(telemetryTopic), nodeId, "telemetry");
  solarTopic(commandTopic, sizeof(commandTopic), nodeId, "command");
  solarTopic(ackTopic, sizeof(ackTopic), nodeId, "ack");
  solarTopic(statusTopic, sizeof(statusTopic), nodeId, "status");
  snprintf(clientId, sizeof(clientId), "hexagon-node-%u-%08lx", nodeId, (unsigned long)bootId);
  mqtt.setId(clientId); mqtt.setUsernamePassword(SOLAR_MQTT_USER, SOLAR_MQTT_PASSWORD);
  mqtt.setCleanSession(true); mqtt.setConnectionTimeout(2000); mqtt.setKeepAliveInterval(15000);
  mqtt.onMessage(onMqtt); mqtt.beginWill(statusTopic, true, 1); mqtt.print("offline"); mqtt.endWill();
  ready = true;
}
void loop() {
  if (!ready) { delay(1); return; }
  readHalls(); const uint32_t now = millis();
  if ((!attempted || now - lastRetry >= MC::RETRY_MS) && !mqtt.connected()) {
    attempted = true; lastRetry = now;
    if (WiFi.status() != WL_CONNECTED) WiFi.begin(APConfig::SSID, APConfig::PASSWORD);
    if (WiFi.status() == WL_CONNECTED && mqtt.connect(APConfig::BROKER_HOST, SOLAR_MQTT_PORT)) {
      if (mqtt.subscribe(commandTopic, 0) != 1) mqtt.stop();
      else { mqtt.beginMessage(statusTopic, true, 0); mqtt.print("online"); mqtt.endMessage(); dirty = true; }
    }
  }
  if (mqtt.connected()) {
    mqtt.poll();
    if ((dirty && now - lastPublish >= NodeConfig::CHANGE_MIN_INTERVAL_MS) || now - lastPublish >= NodeConfig::TELEMETRY_PERIOD_MS) {
      lastPublish = now; if (telemetry()) dirty = false;
    }
  }
}
