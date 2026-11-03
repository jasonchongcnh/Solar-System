/* Hexagon Solar gateway: ESP-NOW <-> newline USB JSON / WebSocket JSON.
 * Tested build target: Arduino-ESP32 3.3.11, ArduinoJson 7, WebSockets 2.7.2.
 * ESP-NOW callbacks only copy small events into bounded queues. All peer,
 * JSON, Serial, WebSocket and command state work happens in loop().
 */
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_idf_version.h>
#include <ArduinoJson.h>
#include <WebSocketsServer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "SolarProtocol.h"
#include "GatewayConfig.h"

using namespace SolarProtocol;
namespace GC = GatewayConfig;
static_assert(sizeof(GC::AP_PASSWORD) >= 9 && sizeof(GC::AP_PASSWORD) <= 64,
              "The AP password must contain 8 to 63 characters");

struct RxEvent {
  uint8_t mac[6], length, data[MAX_PACKET_SIZE];
  int8_t rssi;
  bool hasRssi;
  uint32_t receivedAt;
};
struct PendingControl {
  bool active = false;
  Control packet{};
  uint8_t attempts = 0;
  uint32_t lastAttempt = 0;
};
struct NodeSlot {
  bool used = false;
  uint8_t mac[6]{};
  Telemetry telemetry{};
  uint32_t lastSeen = 0;
  bool hasRssi = false;
  int8_t rssi = 0;
  uint32_t retiredBootIds[4]{};
  uint8_t retiredCursor = 0;
  bool receiptPending = false;
  Receipt receipt{};
  PendingControl control;
};
enum TxKind : uint8_t { TX_RECEIPT, TX_CONTROL };
struct InFlight {
  bool active = false;
  TxKind kind = TX_RECEIPT;
  uint8_t slot = 0;
  uint32_t sequence = 0, started = 0;
};
// A reader records consumption so concatenated JSON or trailing junk is rejected.
struct CommandReader {
  const uint8_t *data;
  size_t length, position = 0;
  CommandReader(const uint8_t *bytes, size_t count) : data(bytes), length(count) {}
  int read() { return position < length ? data[position++] : -1; }
  size_t readBytes(char *out, size_t count) {
    const size_t remaining = length - position;
    if (count > remaining) count = remaining;
    memcpy(out, data + position, count);
    position += count;
    return count;
  }
};

WebSocketsServer webSocket(GC::WEBSOCKET_PORT);
QueueHandle_t rxQueue = nullptr, sentQueue = nullptr;
portMUX_TYPE dropMux = portMUX_INITIALIZER_UNLOCKED;
uint32_t rxQueueDrops = 0, sentQueueDrops = 0;
NodeSlot nodes[MAX_NODES];
InFlight inFlight;
bool radioReady = false, websocketReady = false, everReceived = false;
bool preferReceipt = true;
uint8_t receiptCursor = 0, controlCursor = 0;
uint32_t gatewayBootId = 0, controlSequence = 0;
uint32_t rxPacketCount = 0, duplicateCount = 0, rejectedCount = 0;
uint32_t txPacketCount = 0, txLinkFailures = 0, lastPacketTime = 0;
uint32_t lastHeartbeat = 0, lastConflictReport = 0;
char serialInput[GC::COMMAND_BYTES + 1];
size_t serialLength = 0;
bool discardSerialLine = false;

// Explicit declarations keep Arduino's generated prototypes clear of local types.
bool isOnline(const NodeSlot &node, uint32_t now);
void publishTelemetry(const NodeSlot &node);
void finishControl(NodeSlot &node, bool success, const char *reason);
void processTelemetry(const RxEvent &event);
void processControlAck(const RxEvent &event);
bool issueControl(NodeSlot &node, uint8_t command, uint8_t param);
void sendDocument(JsonDocument &doc);
void parseCommand(const uint8_t *data, size_t length);

void formatMac(const uint8_t *mac, char *out) {
  snprintf(out, 18, "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

void sendDocument(JsonDocument &doc) {
  char output[1400];
  const size_t needed = measureJson(doc);
  if (needed >= sizeof(output)) return;
  const size_t length = serializeJson(doc, output, sizeof(output));
  Serial.write(reinterpret_cast<const uint8_t *>(output), length);
  Serial.write('\n');
  if (websocketReady) webSocket.broadcastTXT(output, length);
}

void reportError(const char *code, const char *message, uint8_t id = 0) {
  JsonDocument doc;
  doc["type"] = "error";
  doc["code"] = code;
  doc["msg"] = message;
  if (id) doc["id"] = id;
  sendDocument(doc);
}

bool isOnline(const NodeSlot &node, uint32_t now) {
  return node.used && static_cast<uint32_t>(now - node.lastSeen) < GC::NODE_TIMEOUT_MS;
}

void publishGateway(const char *type) {
  JsonDocument doc;
  uint8_t staMac[6];
  char mac[18];
  WiFi.macAddress(staMac);
  formatMac(staMac, mac);
  doc["type"] = type;
  doc["role"] = "Base_Station_Gateway";
  doc["mac"] = mac; // STA MAC is the ESP-NOW address, distinct from the AP BSSID.
  doc["protocol"] = "HexagonSolar/1";
  doc["boot_id"] = gatewayBootId;
  doc["channel"] = RADIO_CHANNEL;
  doc["baud"] = GC::SERIAL_BAUD;
  doc["ap_ssid"] = GC::AP_SSID;
  doc["ap_ip"] = WiFi.softAPIP().toString();
  doc["ws_port"] = GC::WEBSOCKET_PORT;
  doc["status"] = radioReady ? "listening" : "radio_error";
  doc["uptime"] = millis() / 1000;
  doc["rx_count"] = rxPacketCount;
  doc["tx_count"] = txPacketCount;
  doc["node_timeout_ms"] = GC::NODE_TIMEOUT_MS;
  sendDocument(doc);
}

void publishTelemetry(const NodeSlot &node) {
  const Telemetry &packet = node.telemetry;
  JsonDocument doc;
  char mac[18];
  formatMac(node.mac, mac);
  doc["type"] = "telemetry";
  doc["id"] = packet.nodeId;
  doc["q"] = packet.q;
  doc["r"] = packet.r;
  // Six Hall switches report magnetic presence; no electrical measurements exist.
  doc["voltage"] = nullptr;
  doc["current"] = nullptr;
  doc["power"] = nullptr;
  doc["temp"] = nullptr;
  doc["hall_mask"] = packet.hallMask;
  JsonArray halls = doc["halls"].to<JsonArray>();
  for (uint8_t i = 0; i < 6; ++i) halls.add((packet.hallMask & (1U << i)) != 0);
  if (packet.configBits == MANUAL_CONFIG) doc["config_bits"] = nullptr;
  else doc["config_bits"] = packet.configBits;
  doc["enabled"] = (packet.flags & ENABLED) != 0;
  doc["power_control_available"] = (packet.flags & POWER_CONTROL_AVAILABLE) != 0;
  doc["seq"] = packet.sequence;
  doc["boot_id"] = packet.bootId;
  doc["uptime"] = packet.uptimeSec;
  doc["mac"] = mac;
  doc["status"] = "online";
  if (node.hasRssi) doc["rssi"] = node.rssi;
  else doc["rssi"] = nullptr;
  doc["rx_count"] = rxPacketCount;
  sendDocument(doc);
}

void finishControl(NodeSlot &node, bool success, const char *reason) {
  const PendingControl &pending = node.control;
  JsonDocument doc;
  doc["type"] = "tx_ack";
  doc["target"] = pending.packet.targetId;
  doc["cmd"] = pending.packet.command;
  doc["param"] = pending.packet.param;
  doc["sequence"] = pending.packet.sequence;
  doc["success"] = success;
  doc["stage"] = success ? "applied" : "failed";
  doc["reason"] = reason;
  doc["attempts"] = pending.attempts;
  doc["tx_count"] = txPacketCount;
  node.control.active = false;
  sendDocument(doc);
}

bool validSourceMac(const uint8_t *mac) {
  uint8_t any = 0;
  for (uint8_t i = 0; i < 6; ++i) any |= mac[i];
  return any != 0 && (mac[0] & 1U) == 0;
}

bool ensurePeer(const uint8_t *mac) {
  if (esp_now_is_peer_exist(mac)) return true;
  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = RADIO_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  return esp_now_add_peer(&peer) == ESP_OK;
}

void processTelemetry(const RxEvent &event) {
  if (!validHeader(event.data, event.length, TELEMETRY, sizeof(Telemetry))) {
    ++rejectedCount;
    return;
  }
  Telemetry packet;
  memcpy(&packet, event.data, sizeof(packet));
  if (!validNodeId(packet.nodeId) || !packet.bootId || packet.hallMask > 63 ||
      (packet.flags & ~(ENABLED | POWER_CONTROL_AVAILABLE)) != 0 ||
      (packet.configBits != MANUAL_CONFIG &&
       (packet.configBits > 7 || packet.nodeId != packet.configBits + 1)) ||
      !validSourceMac(event.mac)) {
    ++rejectedCount;
    return;
  }
  const uint8_t index = packet.nodeId - 1;
  NodeSlot &node = nodes[index];
  const uint32_t now = millis();
  // A MAC cannot occupy several ID slots, and a live ID cannot be stolen by a
  // second board. Hardware ID changes require the old association to expire.
  for (uint8_t i = 0; i < MAX_NODES; ++i) {
    if (i != index && nodes[i].used && sameMac(nodes[i].mac, event.mac)) {
      if (isOnline(nodes[i], now) || inFlight.active) { ++rejectedCount; return; }
      if (nodes[i].control.active) finishControl(nodes[i], false, "node_id_changed");
      nodes[i] = NodeSlot{};
    }
  }
  if (node.used && !sameMac(node.mac, event.mac)) {
    if (isOnline(node, now) || (inFlight.active && inFlight.slot == index)) {
      ++rejectedCount;
      if (now - lastConflictReport >= 5000) {
        lastConflictReport = now;
        reportError("duplicate_id", "A different MAC already owns this online node ID", packet.nodeId);
      }
      return;
    }
    // Install the new peer first. Failed installation must not claim the ID.
    if (!ensurePeer(event.mac)) { ++rejectedCount; return; }
    if (node.control.active) finishControl(node, false, "node_replaced");
    esp_now_del_peer(node.mac);
    node = NodeSlot{};
  } else if (!node.used && !ensurePeer(event.mac)) {
    ++rejectedCount;
    return;
  }
  if (node.used && packet.bootId != node.telemetry.bootId) {
    for (uint32_t retired : node.retiredBootIds) {
      if (retired == packet.bootId) { ++rejectedCount; return; }
    }
    if (node.control.active) finishControl(node, false, "node_rebooted");
    node.retiredBootIds[node.retiredCursor] = node.telemetry.bootId;
    node.retiredCursor = (node.retiredCursor + 1) % 4;
  } else if (node.used) {
    if (packet.sequence == node.telemetry.sequence) {
      ++duplicateCount;
      // Repeat the app receipt if the earlier one was lost. Replays never
      // refresh lastSeen or create a second telemetry sample in the console.
      node.receipt = {header(RECEIPT), packet.nodeId, packet.bootId, packet.sequence, gatewayBootId};
      node.receiptPending = true;
      return;
    }
    if (!newer(packet.sequence, node.telemetry.sequence)) { ++rejectedCount; return; }
  }
  node.used = true;
  memcpy(node.mac, event.mac, 6);
  node.telemetry = packet;
  node.lastSeen = event.receivedAt;
  node.rssi = event.rssi;
  node.hasRssi = event.hasRssi;
  node.receipt = {header(RECEIPT), packet.nodeId, packet.bootId, packet.sequence, gatewayBootId};
  node.receiptPending = true;
  lastPacketTime = event.receivedAt;
  everReceived = true;
  ++rxPacketCount;
  publishTelemetry(node);
}

void processControlAck(const RxEvent &event) {
  if (!validHeader(event.data, event.length, CONTROL_ACK, sizeof(ControlAck))) {
    ++rejectedCount;
    return;
  }
  ControlAck ack;
  memcpy(&ack, event.data, sizeof(ack));
  if (!validNodeId(ack.nodeId) || ack.enabled > 1 || ack.result > STALE_COMMAND) {
    ++rejectedCount;
    return;
  }
  NodeSlot &node = nodes[ack.nodeId - 1];
  PendingControl &pending = node.control;
  if (!node.used || !pending.active || !pending.attempts || !sameMac(node.mac, event.mac) ||
      ack.gatewayBootId != gatewayBootId || ack.nodeBootId != node.telemetry.bootId ||
      ack.sequence != pending.packet.sequence || ack.command != pending.packet.command ||
      ack.param != pending.packet.param) {
    ++rejectedCount;
    return;
  }
  if (ack.result == APPLIED) {
    if (ack.command == SET_POWER && ack.enabled != ack.param) {
      finishControl(node, false, "state_mismatch");
    } else {
      finishControl(node, true, "node_acknowledged");
    }
  } else {
    const char *reason = ack.result == UNSUPPORTED ? "unsupported" :
                         ack.result == STALE_COMMAND ? "stale_command" : "bad_command";
    finishControl(node, false, reason);
  }
}

void queueReceived(const uint8_t *mac, const uint8_t *data, int length, bool hasRssi, int8_t rssi) {
  if (!rxQueue || !mac || !data || length < static_cast<int>(sizeof(Header)) ||
      length > static_cast<int>(MAX_PACKET_SIZE)) return;
  RxEvent event{};
  memcpy(event.mac, mac, 6);
  memcpy(event.data, data, length);
  event.length = static_cast<uint8_t>(length);
  event.hasRssi = hasRssi;
  event.rssi = rssi;
  event.receivedAt = millis();
  if (xQueueSend(rxQueue, &event, 0) != pdTRUE) {
    portENTER_CRITICAL(&dropMux);
    ++rxQueueDrops;
    portEXIT_CRITICAL(&dropMux);
  }
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int length) {
  if (info) queueReceived(info->src_addr, data, length, info->rx_ctrl != nullptr,
                          info->rx_ctrl ? info->rx_ctrl->rssi : 0);
}
#else
void onReceive(const uint8_t *mac, const uint8_t *data, int length) {
  queueReceived(mac, data, length, false, 0);
}
#endif

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)
void onSent(const wifi_tx_info_t *, esp_now_send_status_t status) {
#else
void onSent(const uint8_t *, esp_now_send_status_t status) {
#endif
  if (sentQueue && xQueueSend(sentQueue, &status, 0) != pdTRUE) {
    portENTER_CRITICAL(&dropMux);
    ++sentQueueDrops;
    portEXIT_CRITICAL(&dropMux);
  }
}

bool issueControl(NodeSlot &node, uint8_t command, uint8_t param) {
  const uint8_t id = node.telemetry.nodeId;
  if (!radioReady || !isOnline(node, millis())) {
    reportError("node_unavailable", "No fresh node is available for this command", id);
    return false;
  }
  if (node.control.active) {
    reportError("command_busy", "Wait for this node's pending command acknowledgement", id);
    return false;
  }
  if (command == SET_POWER && !(node.telemetry.flags & POWER_CONTROL_AVAILABLE)) {
    reportError("unsupported", "This Hall-only node has no configured relay output", id);
    return false;
  }
  ++controlSequence;
  node.control = PendingControl{};
  node.control.active = true;
  node.control.packet = {header(CONTROL), id, command, param, node.telemetry.bootId,
                         gatewayBootId, controlSequence};
  JsonDocument doc;
  doc["type"] = "tx_pending";
  doc["target"] = id;
  doc["cmd"] = command;
  doc["param"] = param;
  doc["sequence"] = controlSequence;
  doc["stage"] = "queued";
  sendDocument(doc);
  return true;
}

bool parseId(JsonVariantConst value, uint8_t &id, bool allowAll) {
  if (!value.is<int>() || value.is<bool>()) return false;
  const int parsed = value.as<int>();
  if (parsed < (allowAll ? 0 : 1) || parsed > MAX_NODES) return false;
  id = static_cast<uint8_t>(parsed);
  return true;
}

void parseCommand(const uint8_t *data, size_t length) {
  if (!length || length > GC::COMMAND_BYTES) {
    reportError("command_size", "Command must contain 1 to 512 bytes");
    return;
  }
  JsonDocument doc;
  CommandReader reader{data, length};
  const DeserializationError error = deserializeJson(doc, reader, DeserializationOption::NestingLimit(4));
  while (reader.position < length && (data[reader.position] == ' ' || data[reader.position] == '\t' ||
         data[reader.position] == '\r' || data[reader.position] == '\n')) ++reader.position;
  if (error || reader.position != length || !doc.is<JsonObject>() || !doc["cmd"].is<const char *>()) {
    reportError("invalid_json", "Expected exactly one JSON object with a string cmd");
    return;
  }
  const char *command = doc["cmd"];
  if (strcmp(command, "ping") == 0) { publishGateway("pong"); return; }
  if (strcmp(command, "set_path") == 0 || strcmp(command, "raw") == 0) {
    reportError("unsupported", "The Hall-sensor radio protocol does not implement route or raw commands");
    return;
  }
  uint8_t id = 0, wireCommand = 0, param = 0;
  if (strcmp(command, "set_power") == 0 || strcmp(command, "all_power") == 0) {
    if (!doc["enabled"].is<bool>()) {
      reportError("invalid_enabled", "enabled must be a JSON boolean");
      return;
    }
    param = doc["enabled"].as<bool>() ? 1 : 0;
    wireCommand = SET_POWER;
    if (strcmp(command, "set_power") == 0 && !parseId(doc["id"], id, false)) {
      reportError("invalid_id", "set_power requires an integer id from 1 to 8");
      return;
    }
  } else if (strcmp(command, "request_telemetry") == 0) {
    wireCommand = REQUEST_TELEMETRY;
    if (!doc["id"].isUnbound() && !parseId(doc["id"], id, true)) {
      reportError("invalid_id", "request_telemetry id must be an integer from 0 to 8");
      return;
    }
  } else {
    reportError("unknown_command", "Supported commands: ping, request_telemetry, set_power, all_power");
    return;
  }
  if (id) {
    if (!nodes[id - 1].used) reportError("unknown_node", "Wait for telemetry before commanding this node", id);
    else issueControl(nodes[id - 1], wireCommand, param);
  } else {
    uint8_t count = 0;
    for (NodeSlot &node : nodes) {
      if (isOnline(node, millis())) { ++count; issueControl(node, wireCommand, param); }
    }
    if (!count) reportError("no_online_nodes", "No fresh nodes are available");
  }
}

void processSerial() {
  // Bound each loop's USB work so a noisy client cannot starve the radio.
  for (uint16_t budget = 0; budget < 256 && Serial.available(); ++budget) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (!discardSerialLine && serialLength) {
        parseCommand(reinterpret_cast<const uint8_t *>(serialInput), serialLength);
      }
      serialLength = 0;
      discardSerialLine = false;
    } else if (!discardSerialLine) {
      if (c == '\0' || serialLength >= GC::COMMAND_BYTES) {
        serialLength = 0;
        discardSerialLine = true;
        reportError("command_size", "Invalid or oversized serial line discarded through its next newline");
      } else serialInput[serialLength++] = c;
    }
  }
}

void onWebSocket(uint8_t client, WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    publishGateway("ready");
  } else if (type == WStype_TEXT) {
    parseCommand(payload, length);
  } else if (type == WStype_FRAGMENT_TEXT_START || type == WStype_FRAGMENT_BIN_START || type == WStype_BIN) {
    reportError("unsupported_frame", "Send one complete text JSON object per WebSocket message");
    webSocket.disconnect(client);
  }
}

void serviceRadio() {
  esp_now_send_status_t status;
  while (xQueueReceive(sentQueue, &status, 0) == pdTRUE) {
    if (status != ESP_NOW_SEND_SUCCESS) ++txLinkFailures;
    inFlight.active = false;
  }
  RxEvent event;
  for (uint8_t budget = 0; budget < 8 && xQueueReceive(rxQueue, &event, 0) == pdTRUE; ++budget) {
    Header h;
    memcpy(&h, event.data, sizeof(h));
    if (h.type == TELEMETRY) processTelemetry(event);
    else if (h.type == CONTROL_ACK) processControlAck(event);
    else ++rejectedCount;
  }
  const uint32_t now = millis();
  if (inFlight.active && now - inFlight.started >= GC::SEND_CALLBACK_TIMEOUT_MS) {
    // Do not start overlapping sends after a lost callback: a late callback
    // could otherwise complete the wrong transaction. USB/AP remain usable.
    radioReady = false;
    inFlight.active = false;
    reportError("radio_stalled", "ESP-NOW send callback timed out; restart the gateway");
    for (NodeSlot &node : nodes) {
      if (node.control.active) finishControl(node, false, "radio_stalled");
    }
  }
  for (NodeSlot &node : nodes) {
    PendingControl &pending = node.control;
    if (!pending.active) continue;
    if (!isOnline(node, now)) finishControl(node, false, "node_offline");
    else if (pending.attempts >= GC::CONTROL_ATTEMPTS && now - pending.lastAttempt >= GC::CONTROL_ACK_MS)
      finishControl(node, false, "ack_timeout");
  }
  if (!radioReady || inFlight.active) return;
  // Alternate traffic classes and round-robin nodes. Receipt floods cannot
  // monopolize the radio; command retries also leave capacity for receipts.
  for (uint8_t pass = 0; pass < 2; ++pass) {
    const bool receipts = pass == 0 ? preferReceipt : !preferReceipt;
    uint8_t &cursor = receipts ? receiptCursor : controlCursor;
    for (uint8_t offset = 0; offset < MAX_NODES; ++offset) {
      const uint8_t index = (cursor + offset) % MAX_NODES;
      NodeSlot &node = nodes[index];
      if (!node.used) continue;
      const uint8_t *bytes;
      size_t length;
      uint32_t sequence;
      if (receipts) {
        if (!node.receiptPending) continue;
        bytes = reinterpret_cast<const uint8_t *>(&node.receipt);
        length = sizeof(node.receipt);
        sequence = node.receipt.telemetrySequence;
        node.receiptPending = false;
      } else {
        PendingControl &pending = node.control;
        if (!pending.active || pending.attempts >= GC::CONTROL_ATTEMPTS ||
            (pending.attempts && now - pending.lastAttempt < GC::CONTROL_ACK_MS)) continue;
        bytes = reinterpret_cast<const uint8_t *>(&pending.packet);
        length = sizeof(pending.packet);
        sequence = pending.packet.sequence;
        ++pending.attempts;
        pending.lastAttempt = now;
      }
      cursor = (index + 1) % MAX_NODES;
      preferReceipt = !receipts;
      inFlight.active = true;
      inFlight.kind = receipts ? TX_RECEIPT : TX_CONTROL;
      inFlight.slot = index;
      inFlight.sequence = sequence;
      inFlight.started = now;
      ++txPacketCount;
      if (esp_now_send(node.mac, bytes, length) != ESP_OK) {
        inFlight.active = false;
        ++txLinkFailures;
      }
      return;
    }
  }
}

void publishHeartbeat() {
  uint32_t droppedRx, droppedSent;
  portENTER_CRITICAL(&dropMux);
  droppedRx = rxQueueDrops;
  droppedSent = sentQueueDrops;
  portEXIT_CRITICAL(&dropMux);
  const uint32_t now = millis();
  JsonDocument doc;
  doc["type"] = "heartbeat";
  doc["uptime"] = now / 1000;
  doc["radio_ready"] = radioReady;
  doc["rx_packets"] = rxPacketCount;
  doc["tx_packets"] = txPacketCount;
  doc["duplicate_packets"] = duplicateCount;
  doc["rejected_packets"] = rejectedCount;
  doc["rx_queue_drops"] = droppedRx;
  doc["tx_queue_drops"] = droppedSent;
  doc["tx_link_failures"] = txLinkFailures;
  if (everReceived) doc["last_rx_ago_ms"] = static_cast<uint32_t>(now - lastPacketTime);
  else doc["last_rx_ago_ms"] = nullptr;
  JsonArray peers = doc["nodes"].to<JsonArray>();
  for (const NodeSlot &node : nodes) {
    if (!node.used) continue;
    JsonObject peer = peers.add<JsonObject>();
    peer["id"] = node.telemetry.nodeId;
    peer["online"] = isOnline(node, now);
    peer["age_ms"] = static_cast<uint32_t>(now - node.lastSeen);
  }
  sendDocument(doc);
}

void setup() {
  Serial.begin(GC::SERIAL_BAUD);
  gatewayBootId = esp_random();
  if (!gatewayBootId) gatewayBootId = 1;
  rxQueue = xQueueCreate(GC::RX_QUEUE_LENGTH, sizeof(RxEvent));
  sentQueue = xQueueCreate(2, sizeof(esp_now_send_status_t));
  if (!rxQueue || !sentQueue) {
    reportError("queue_init", "Insufficient memory to initialize radio queues");
    return;
  }
  WiFi.persistent(false);
  if (!WiFi.mode(WIFI_AP_STA)) {
    reportError("wifi_init", "Could not initialize AP and STA interfaces");
    return;
  }
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);
  if (!WiFi.softAP(GC::AP_SSID, GC::AP_PASSWORD, RADIO_CHANNEL, false, 4) ||
      esp_wifi_set_channel(RADIO_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK ||
      esp_wifi_set_ps(WIFI_PS_NONE) != ESP_OK) {
    reportError("wifi_channel", "Could not start the access point on the required radio channel");
    return;
  }
  webSocket.begin();
  webSocket.onEvent(onWebSocket);
  webSocket.enableHeartbeat(15000, 3000, 2);
  websocketReady = true;
  if (esp_now_init() != ESP_OK || esp_now_register_recv_cb(onReceive) != ESP_OK ||
      esp_now_register_send_cb(onSent) != ESP_OK) {
    reportError("esp_now_init", "Could not initialize ESP-NOW callbacks");
    return;
  }
  radioReady = true;
  publishGateway("ready");
}

void loop() {
  if (websocketReady) webSocket.loop();
  processSerial();
  if (rxQueue && sentQueue) serviceRadio();
  if (millis() - lastHeartbeat >= GC::HEARTBEAT_MS) {
    lastHeartbeat = millis();
    publishHeartbeat();
  }
  delay(1);
}
