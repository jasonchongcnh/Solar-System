/* UNO R4 WiFi (RA4M1): creates the system AP, aggregates MQTT nodes.
 * Uses the stock ESP32-S3 connectivity firmware through WiFiS3.
 */
#include <WiFiS3.h>
#include "MqttSupport.h"
#include "AccessPointConfig.h"
#include "UnoAccessPoint.h"
WiFiClient network;
MqttClient mqtt(network);
struct SolarNode {
  bool seen = false, online = false, pending = false;
  char mac[18] = {};
  uint32_t boot = 0, seq = 0, lastSeen = 0, uptime = 0;
  uint32_t commandSeq = 0, attemptedAt = 0, expires = 0;
  uint8_t attempts = 0;
  bool enabled = false;
  char command[24] = {};
};
SolarNode nodes[MC::MAX_NODES];
char eventsTopic[96], commandTopic[96], statusTopic[96];
uint32_t session = 0, nextCommand = 0, lastRetry = 0, lastHeartbeat = 0;
char serialLine[513]; size_t serialLength = 0; bool serialDiscard = false;
bool networkAttempted = false;
bool apStarted = false, apAttempted = false;
uint32_t lastApAttempt = 0;

void emit(JsonDocument &doc) {
  serializeJson(doc, Serial); Serial.println();
  solarPublish(mqtt, eventsTopic, doc);
}
void error(const char *code, unsigned id = 0) {
  JsonDocument doc; doc["type"] = "error"; doc["code"] = code; doc["msg"] = code;
  if (id) doc["id"] = id;
  emit(doc);
}
void gateway(const char *type) {
  JsonDocument doc; doc["type"] = type; doc["role"] = "Base_Station_Gateway";
  doc["protocol"] = "HexagonSolar/MQTT/1"; doc["gateway"] = MC::GATEWAY;
  doc["network_mode"] = "access_point"; doc["ap_ssid"] = APConfig::SSID;
  doc["ap_ip"] = APConfig::address().toString(); doc["broker_host"] = APConfig::BROKER_HOST;
  doc["ap_active"] = apStarted; doc["channel"] = APConfig::CHANNEL;
  doc["ap_max_stations_requested"] = APConfig::MAX_STATIONS;
  doc["ap_capacity_accepted"] = apStarted; // Command accepted, not a measured client count.
  doc["connectivity_firmware"] = WiFi.firmwareVersion();
  doc["boot_id"] = session; doc["uptime"] = millis() / 1000;
  doc["status"] = mqtt.connected() ? "listening" : "mqtt_offline";
  doc["node_timeout_ms"] = MC::NODE_TIMEOUT_MS; doc["baud"] = 115200;
  emit(doc);
}
void finish(unsigned id, bool success, const char *reason) {
  SolarNode &node = nodes[id - 1];
  JsonDocument doc; doc["type"] = "tx_ack"; doc["target"] = id;
  doc["cmd"] = !strcmp(node.command, "set_power") ? 1 : 2;
  doc["sequence"] = node.commandSeq; doc["success"] = success;
  doc["stage"] = success ? "applied" : "failed"; doc["reason"] = reason;
  doc["attempts"] = node.attempts; node.pending = false; emit(doc);
}
bool apActive() {
  const int status = WiFi.status();
  // Joining/leaving stations changes the AP status; neither means AP failure.
  return status == WL_AP_LISTENING || status == WL_AP_CONNECTED;
}
void serviceAccessPoint(uint32_t now) {
  // The ESP32-S3 can retain an old AP across an RA4M1-only reset. Start our
  // configured AP once per sketch boot instead of trusting that inherited state.
  if (apStarted && apActive()) return;
  if (apStarted) {
    mqtt.stop(); // Never carry a pending control across a lost AP session.
    for (unsigned i = 0; i < MC::MAX_NODES; ++i) {
      SolarNode &node = nodes[i];
      if (node.pending) finish(i + 1, false, "access_point_lost");
      if (node.online) {
        node.online = false;
        JsonDocument doc; doc["type"] = "node_status"; doc["id"] = i + 1;
        doc["status"] = "offline"; emit(doc);
      }
    }
    apStarted = false;
    error("access_point_lost");
  }
  if (apAttempted && now - lastApAttempt < APConfig::RESTART_MS) return;
  apAttempted = true; lastApAttempt = now;
  if (!APConfig::credentialsValid()) {
    error("invalid_ap_credentials"); return;
  }
  if (APConfig::MAX_STATIONS < MC::MAX_NODES + 1 || APConfig::MAX_STATIONS > 10) {
    error("invalid_ap_station_limit"); return;
  }
  if (WiFi.status() == WL_NO_MODULE) { error("wifi_module_missing"); return; }
  mqtt.stop();
  WiFi.end();
  WiFi.config(APConfig::address());
  apStarted = startUnoAccessPoint(APConfig::SSID, APConfig::PASSWORD, APConfig::CHANNEL, APConfig::MAX_STATIONS);
  if (!apStarted) {
    WiFi.end(); // Do not leave a partial AP or fall back to five stations.
    error("access_point_capacity_rejected");
  }
}
void transmit(unsigned id) {
  SolarNode &node = nodes[id - 1];
  JsonDocument doc; doc["id"] = id; doc["cmd"] = node.command;
  doc["enabled"] = node.enabled; doc["node_boot_id"] = node.boot;
  doc["gateway_boot_id"] = session; doc["sequence"] = node.commandSeq;
  doc["expires_uptime_ms"] = node.expires;
  char topic[96]; solarTopic(topic, sizeof(topic), id, "command");
  ++node.attempts; node.attemptedAt = millis();
  if (!solarPublish(mqtt, topic, doc)) finish(id, false, "mqtt_publish_failed");
}
void issue(unsigned id, const char *command, bool enabled) {
  SolarNode &node = nodes[id - 1];
  if (!node.online || millis() - node.lastSeen >= MC::NODE_TIMEOUT_MS) { error("node_offline", id); return; }
  if (node.pending) { error("command_busy", id); return; }
  node.pending = true; node.commandSeq = ++nextCommand; node.attempts = 0;
  node.enabled = enabled; snprintf(node.command, sizeof(node.command), "%s", command);
  // The node checks its own boot ID and uptime, so old commands cannot cross a reboot.
  node.expires = node.uptime + (millis() - node.lastSeen) + 8000;
  transmit(id);
  if (node.pending) {
    JsonDocument doc; doc["type"] = "tx_pending"; doc["target"] = id;
    doc["sequence"] = node.commandSeq; emit(doc);
  }
}
void command(JsonDocument &doc) {
  if (!doc["cmd"].is<const char *>()) { error("invalid_command"); return; }
  const char *cmd = doc["cmd"];
  if (!strcmp(cmd, "ping")) { gateway("pong"); return; }
  const bool power = !strcmp(cmd, "set_power") || !strcmp(cmd, "all_power");
  if (!power && strcmp(cmd, "request_telemetry")) { error("unsupported_command"); return; }
  if (power && !doc["enabled"].is<bool>()) { error("invalid_enabled"); return; }
  unsigned id = 0;
  if (strcmp(cmd, "all_power") && !doc["id"].isUnbound()) {
    if (!solarId(doc["id"])) { error("invalid_id"); return; }
    id = doc["id"].as<unsigned>();
  }
  if (!strcmp(cmd, "set_power") && !id) { error("invalid_id"); return; }
  if (!mqtt.connected()) { error("mqtt_offline"); return; }
  const char *wire = power ? "set_power" : "request_telemetry";
  if (id) issue(id, wire, doc["enabled"] | false);
  else {
    unsigned count = 0;
    for (unsigned i = 1; i <= MC::MAX_NODES; ++i)
      if (nodes[i-1].online && millis() - nodes[i-1].lastSeen < MC::NODE_TIMEOUT_MS) {
        ++count; issue(i, wire, doc["enabled"] | false);
      }
    if (!count) error("no_online_nodes");
  }
}
int macHex(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}
bool normalizeMac(JsonVariantConst value, char (&canonical)[18]) {
  if (!value.is<const char *>()) return false;
  const char *text = value.as<const char *>();
  if (strlen(text) != 17) return false;
  uint8_t bytes[6]; bool nonzero = false;
  for (unsigned i = 0; i < 6; ++i) {
    const unsigned offset = 3 * i;
    const int high = macHex(text[offset]), low = macHex(text[offset+1]);
    if (high < 0 || low < 0 || (i < 5 && text[offset+2] != ':')) return false;
    bytes[i] = uint8_t((high << 4) | low); nonzero |= bytes[i] != 0;
  }
  if (!nonzero || (bytes[0] & 1U)) return false; // Only individual, nonzero addresses.
  snprintf(canonical, sizeof(canonical), "%02X:%02X:%02X:%02X:%02X:%02X",
           bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  return true;
}
bool normalizeEdgeNeighbors(JsonDocument &doc, unsigned id, const char *localMac) {
  const bool missingState = doc["neighbor_detection"].isUnbound();
  const bool missingNeighbors = doc["edge_neighbors"].isUnbound();
  if (missingState && missingNeighbors) {
    // Hall-only firmware remains usable, but never acquires a guessed identity.
    doc["neighbor_detection"] = "disabled";
    JsonArray empty = doc["edge_neighbors"].to<JsonArray>();
    for (unsigned i = 0; i < 6; ++i) empty.add(nullptr);
    return true;
  }
  if (missingState || missingNeighbors || !doc["neighbor_detection"].is<const char *>() ||
      !doc["edge_neighbors"].is<JsonArray>()) return false;
  const char *state = doc["neighbor_detection"];
  const bool ready = !strcmp(state, "ready");
  if (!ready && strcmp(state, "disabled") && strcmp(state, "hardware_error")) return false;
  JsonArray peers = doc["edge_neighbors"].as<JsonArray>();
  if (peers.size() != 6) return false;
  const unsigned mask = doc["hall_mask"];
  for (unsigned side = 0; side < 6; ++side) {
    JsonVariant peer = peers[side];
    if (peer.isNull()) continue;
    if (!ready || !(mask & (1U << side)) || !peer.is<JsonObject>() ||
        !solarId(peer["id"]) || peer["id"].as<unsigned>() == id ||
        !solarUInt(peer["side"]) || peer["side"].as<unsigned>() >= 6 ||
        !solarUInt(peer["boot_id"]) || peer["boot_id"].as<uint32_t>() == 0 ||
        !solarUInt(peer["age_ms"]) || peer["age_ms"].as<uint32_t>() >= 3000) return false;
    char peerMac[18];
    if (!normalizeMac(peer["mac"], peerMac) || !strcmp(localMac, peerMac)) return false;
    peer["mac"] = peerMac;
    for (unsigned previous = 0; previous < side; ++previous) {
      JsonVariant other = peers[previous];
      if (!other.isNull() && (other["id"].as<unsigned>() == peer["id"].as<unsigned>() ||
          !strcmp(other["mac"].as<const char *>(), peerMac))) return false;
    }
  }
  return true;
}
void onMqtt(int size) {
  const String topic = mqtt.messageTopic();
  JsonDocument doc; if (!solarRead(mqtt, size, doc)) return;
  if (topic == commandTopic) { command(doc); return; }
  if (!solarId(doc["id"])) return;
  const unsigned id = doc["id"];
  SolarNode &node = nodes[id - 1];
  char expected[96]; solarTopic(expected, sizeof(expected), id, "ack");
  if (topic == expected) {
    if (node.pending && solarUInt(doc["gateway_boot_id"]) && solarUInt(doc["node_boot_id"]) &&
        solarUInt(doc["sequence"]) && doc["gateway_boot_id"].as<uint32_t>() == session &&
        doc["node_boot_id"].as<uint32_t>() == node.boot && doc["sequence"].as<uint32_t>() == node.commandSeq &&
        doc["cmd"].is<const char *>() && !strcmp(doc["cmd"], node.command) && doc["success"].is<bool>())
      finish(id, doc["success"], doc["success"].as<bool>() ? "node_ack" : "unsupported_or_rejected");
    return;
  }
  solarTopic(expected, sizeof(expected), id, "telemetry");
  if (topic != expected || !solarUInt(doc["boot_id"]) || !solarUInt(doc["seq"]) ||
      !solarUInt(doc["uptime_ms"]) || !solarUInt(doc["hall_mask"]) || doc["hall_mask"].as<unsigned>() > 63 ||
      doc["boot_id"].as<uint32_t>() == 0 || !doc["enabled"].is<bool>() ||
      !doc["power_control_available"].is<bool>()) return;
  char localMac[18];
  if (!normalizeMac(doc["mac"], localMac) || !normalizeEdgeNeighbors(doc, id, localMac)) return;
  doc["mac"] = localMac;
  // Edge identities are local observations. The console requires fresh, reciprocal
  // claims matching both nodes' current MAC and boot ID before confirming a link.
  doc["type"] = "telemetry"; doc["status"] = "online";
  const unsigned mask = doc["hall_mask"];
  JsonArray halls = doc["halls"].to<JsonArray>();
  for (unsigned i = 0; i < 6; ++i) halls.add(bool(mask & (1U << i)));
  doc["voltage"] = nullptr; doc["current"] = nullptr; doc["power"] = nullptr; doc["temp"] = nullptr;
  if (measureJson(doc) > MC::MAX_FRAME) return;
  if (node.online && millis() - node.lastSeen < MC::NODE_TIMEOUT_MS && strcmp(node.mac, localMac)) {
    error("duplicate_node_id", id); return;
  }
  const uint32_t boot = doc["boot_id"], seq = doc["seq"];
  if (node.seen && node.boot == boot && !solarNewer(seq, node.seq)) return;
  if (node.pending && node.boot != boot) finish(id, false, "node_rebooted");
  node.seen = node.online = true; node.boot = boot; node.seq = seq;
  node.lastSeen = millis(); node.uptime = doc["uptime_ms"];
  snprintf(node.mac, sizeof(node.mac), "%s", localMac);
  emit(doc);
}
void serialCommands() {
  for (unsigned budget = 0; budget < 256 && Serial.available(); ++budget) {
    const char c = Serial.read();
    if (c == '\n') {
      if (!serialDiscard && serialLength) {
        JsonDocument doc;
        if (solarJson(doc, (const uint8_t *)serialLine, serialLength)) command(doc);
        else error("invalid_json");
      }
      serialLength = 0; serialDiscard = false;
    } else if (!serialDiscard) {
      if (serialLength < 512) serialLine[serialLength++] = c;
      else { serialDiscard = true; error("command_too_large"); }
    }
  }
}
void setup() {
  Serial.begin(115200); // No wait for USB: runs unattended.
  randomSeed(micros() ^ analogRead(A0)); session = uint32_t(random(1, 0x7fffffff));
  snprintf(eventsTopic, sizeof(eventsTopic), "%s/gateways/%s/events", MC::ROOT, MC::GATEWAY);
  snprintf(commandTopic, sizeof(commandTopic), "%s/gateways/%s/command", MC::ROOT, MC::GATEWAY);
  snprintf(statusTopic, sizeof(statusTopic), "%s/gateways/%s/status", MC::ROOT, MC::GATEWAY);
  mqtt.setId("hexagon-uno-r4"); mqtt.setUsernamePassword(SOLAR_MQTT_USER, SOLAR_MQTT_PASSWORD);
  mqtt.setConnectionTimeout(2000); mqtt.setKeepAliveInterval(15000); mqtt.setCleanSession(true);
  mqtt.onMessage(onMqtt);
  mqtt.beginWill(statusTopic, true, 1); mqtt.print("offline"); mqtt.endWill();
  serviceAccessPoint(millis());
  gateway("ready");
}
void loop() {
  const uint32_t now = millis();
  serviceAccessPoint(now);
  serialCommands();
  if (apStarted && (!networkAttempted || now - lastRetry >= MC::RETRY_MS) && !mqtt.connected()) {
    networkAttempted = true; lastRetry = now;
    if (mqtt.connect(APConfig::BROKER_HOST, SOLAR_MQTT_PORT)) {
      char topic[96]; snprintf(topic, sizeof(topic), "%s/nodes/+/telemetry", MC::ROOT);
      const bool telemetryOK = mqtt.subscribe(topic, 0) == 1;
      snprintf(topic, sizeof(topic), "%s/nodes/+/ack", MC::ROOT);
      if (!telemetryOK || mqtt.subscribe(topic, 0) != 1 || mqtt.subscribe(commandTopic, 0) != 1) mqtt.stop();
      else {
        mqtt.beginMessage(statusTopic, true, 0); mqtt.print("online"); mqtt.endMessage();
        gateway("ready");
      }
    }
  }
  if (mqtt.connected()) mqtt.poll();
  for (unsigned i = 0; i < MC::MAX_NODES; ++i) {
    SolarNode &node = nodes[i];
    if (node.online && millis() - node.lastSeen >= MC::NODE_TIMEOUT_MS) {
      node.online = false;
      JsonDocument doc; doc["type"] = "node_status"; doc["id"] = i+1; doc["status"] = "offline"; emit(doc);
    }
    if (node.pending && millis() - node.attemptedAt >= MC::COMMAND_TIMEOUT_MS) {
      if (!mqtt.connected() || node.attempts >= 3) finish(i+1, false, "ack_timeout");
      else transmit(i+1);
    }
  }
  if (now - lastHeartbeat >= 5000) { lastHeartbeat = now; gateway("heartbeat"); }
}
