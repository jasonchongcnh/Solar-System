#include <iostream>
#include <stdexcept>
#include "../../firmware/esp32_base_station_gateway/esp32_base_station_gateway.ino"

static unsigned checks = 0;
void check(bool passed, const char *description) {
  ++checks;
  if (!passed) throw std::runtime_error(description);
}
void reset() {
  Mock::now = 1000;
  Mock::frames.clear();
  Mock::peers.clear();
  Mock::wsMessages.clear();
  Mock::sendResult = Mock::peerResult = ESP_OK;
  Serial.output.clear();
  Serial.input.clear();
  for (NodeSlot &node : nodes) node = NodeSlot{};
  inFlight = InFlight{};
  delete rxQueue;
  delete sentQueue;
  rxQueue = xQueueCreate(GC::RX_QUEUE_LENGTH, sizeof(RxEvent));
  sentQueue = xQueueCreate(2, sizeof(esp_now_send_status_t));
  radioReady = websocketReady = true;
  everReceived = false;
  preferReceipt = true;
  receiptCursor = controlCursor = 0;
  gatewayBootId = 99;
  controlSequence = rxPacketCount = duplicateCount = rejectedCount = 0;
  txPacketCount = txLinkFailures = lastPacketTime = lastHeartbeat = lastConflictReport = 0;
  rxQueueDrops = sentQueueDrops = 0;
  serialLength = 0;
  discardSerialLine = false;
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
  check(!deserializeJson(doc, lastLine()), "gateway emitted valid JSON");
  return doc;
}
void command(const std::string &json) {
  Serial.output.clear();
  parseCommand(reinterpret_cast<const uint8_t *>(json.data()), json.size());
}
template <class Packet>
RxEvent eventFor(const Packet &packet, uint8_t macSuffix = 1) {
  RxEvent event{};
  const uint8_t mac[6] = {2, 0, 0, 0, 0, macSuffix};
  memcpy(event.mac, mac, 6);
  memcpy(event.data, &packet, sizeof(packet));
  event.length = sizeof(packet);
  event.receivedAt = Mock::now;
  event.hasRssi = true;
  event.rssi = -61;
  return event;
}
Telemetry sample(uint8_t id = 1, uint32_t sequence = 1, uint32_t boot = 50) {
  return {header(TELEMETRY), id, 37, MANUAL_CONFIG, ENABLED, boot, sequence, 17, 0, 0};
}
void learn(bool relay = false) {
  auto packet = sample();
  if (relay) packet.flags |= POWER_CONTROL_AVAILABLE;
  processTelemetry(eventFor(packet));
  nodes[0].receiptPending = false;
  Serial.output.clear();
}
void completedSend() { onSent(nullptr, ESP_NOW_SEND_SUCCESS); serviceRadio(); }

void parserTests() {
  reset();
  command("  { \"cmd\" : \"ping\" } \r\n");
  check(output()["type"] == "pong", "valid JSON whitespace accepted");
  for (const char *invalid : {"{\"cmd\":\"ping\"}x", "{\"cmd\":\"ping\"} {}", "{\"cmd\":\"ping\"}{\"cmd\":\"ping\"}", "[]", "{\"cmd\":true}", "{\"cmd\":\"ping\""}) {
    command(invalid);
    check(output()["code"] == "invalid_json", "malformed, trailing, or wrong-type command rejected");
  }
  learn(true);
  for (const char *enabled : {"1", "0", "\"true\"", "null"}) {
    command(std::string("{\"cmd\":\"set_power\",\"id\":1,\"enabled\":") + enabled + "}");
    check(output()["code"] == "invalid_enabled", "enabled requires JSON boolean");
  }
  for (const char *id : {"0", "9", "-1", "1.0", "true", "null", "\"1\""}) {
    command(std::string("{\"cmd\":\"set_power\",\"id\":") + id + ",\"enabled\":true}");
    check(output()["code"] == "invalid_id", "node ID requires bounded integer");
  }
  command("{\"cmd\":\"request_telemetry\",\"id\":null}");
  check(output()["code"] == "invalid_id", "explicit null ID is not omitted ID");
  command("{\"cmd\":\"request_telemetry\"}");
  check(nodes[0].control.active && nodes[0].control.packet.command == REQUEST_TELEMETRY,
        "omitted telemetry target fans out to fresh nodes");
  reset();
  const std::string stream = std::string(600, 'x') + "{\"cmd\":\"ping\"}\n{\"cmd\":\"ping\"}\n";
  Serial.input.insert(Serial.input.end(), stream.begin(), stream.end());
  while (Serial.available()) processSerial();
  check(Serial.output.find("command_size") != std::string::npos, "oversized serial line rejected");
  check(output()["type"] == "pong", "serial parser resynchronizes after newline");
  size_t pongs = 0, start = 0;
  while ((start = Serial.output.find("\"pong\"", start)) != std::string::npos) { ++pongs; ++start; }
  check(pongs == 1, "oversized line suffix never executes a command");
}

void telemetryTests() {
  reset();
  processTelemetry(eventFor(sample()));
  JsonDocument doc = output();
  check(doc["voltage"].isNull() && doc["current"].isNull() && doc["power"].isNull() && doc["temp"].isNull(),
        "unmeasured electrical metrics are null");
  check(doc["hall_mask"] == 37 && doc["halls"].size() == 6 && doc["halls"][0] == true && doc["halls"][1] == false,
        "six Hall bits reach console JSON");
  check(doc["config_bits"].isNull() && doc["rssi"] == -61, "manual config is null and RSSI comes from RX event");
  check(nodes[0].used && nodes[0].receiptPending, "validated telemetry learns peer and schedules receipt");
  const uint32_t seen = nodes[0].lastSeen;
  const size_t emitted = Serial.output.size();
  Mock::now += 100;
  processTelemetry(eventFor(sample()));
  check(Serial.output.size() == emitted && nodes[0].lastSeen == seen && duplicateCount == 1,
        "duplicate ACK does not refresh freshness or duplicate console sample");
  nodes[0].receiptPending = false;
  processTelemetry(eventFor(sample(1, 0)));
  check(!nodes[0].receiptPending && nodes[0].lastSeen == seen, "old sequence cannot refresh node");
  processTelemetry(eventFor(sample(1, 2), 2));
  check(nodes[0].mac[5] == 1, "live duplicate ID rejected");
  Mock::now += GC::NODE_TIMEOUT_MS;
  processTelemetry(eventFor(sample(1, 2), 2));
  check(nodes[0].mac[5] == 2, "expired node ID can be replaced");
  reset();
  Mock::peerResult = ESP_FAIL;
  processTelemetry(eventFor(sample()));
  check(!nodes[0].used, "failed peer registration does not claim ID");
  reset();
  auto invalid = sample(); invalid.configBits = 4;
  processTelemetry(eventFor(invalid));
  check(!nodes[0].used, "hardware ID and config mismatch rejected");
  learn(true);
  command("{\"cmd\":\"set_power\",\"id\":1,\"enabled\":false}");
  processTelemetry(eventFor(sample(1, 1, 51)));
  check(!nodes[0].control.active && nodes[0].telemetry.bootId == 51, "reboot clears pending old-session command");
  processTelemetry(eventFor(sample(1, 100, 50)));
  check(nodes[0].telemetry.bootId == 51, "retired boot replay rejected");
}

void commandTests() {
  reset();
  learn();
  command("{\"cmd\":\"set_power\",\"id\":1,\"enabled\":false}");
  check(output()["code"] == "unsupported" && !nodes[0].control.active, "Hall-only node rejects power command");
  reset();
  learn(true);
  command("{\"cmd\":\"set_power\",\"id\":1,\"enabled\":false}");
  check(output()["type"] == "tx_pending", "queuing is not reported as application success");
  serviceRadio();
  const Control sent = nodes[0].control.packet;
  check(Mock::frames.size() == 1 && nodes[0].control.attempts == 1, "control sent once initially");
  completedSend();
  check(nodes[0].control.active, "MAC send success is not application success");
  ControlAck ack{header(CONTROL_ACK), 1, SET_POWER, 0, APPLIED, 0, 50, gatewayBootId, sent.sequence + 1};
  processControlAck(eventFor(ack));
  check(nodes[0].control.active, "wrong ACK sequence ignored");
  ack.sequence = sent.sequence;
  processControlAck(eventFor(ack, 2));
  check(nodes[0].control.active, "wrong MAC ACK ignored");
  ack.gatewayBootId += 1;
  processControlAck(eventFor(ack));
  check(nodes[0].control.active, "wrong gateway session ACK ignored");
  ack.gatewayBootId = gatewayBootId;
  processControlAck(eventFor(ack));
  check(!nodes[0].control.active && output()["success"] == true && output()["stage"] == "applied",
        "only correlated APPLIED ACK completes command");

  reset(); learn(true);
  command("{\"cmd\":\"set_power\",\"id\":1,\"enabled\":true}");
  serviceRadio(); completedSend();
  for (unsigned attempt = 1; attempt < GC::CONTROL_ATTEMPTS; ++attempt) {
    Mock::now += GC::CONTROL_ACK_MS;
    serviceRadio(); completedSend();
  }
  check(Mock::frames.size() == GC::CONTROL_ATTEMPTS, "retry count is bounded");
  check(Mock::frames[0].data == Mock::frames[1].data && Mock::frames[1].data == Mock::frames[2].data,
        "all retries preserve the identical sequence and session");
  Mock::now += GC::CONTROL_ACK_MS;
  serviceRadio();
  check(!nodes[0].control.active && output()["success"] == false && output()["reason"] == "ack_timeout",
        "missing application ACK fails after retries");
  reset(); learn(true);
  nodes[0].receiptPending = true;
  command("{\"cmd\":\"set_power\",\"id\":1,\"enabled\":true}");
  serviceRadio();
  nodes[0].receiptPending = true;
  completedSend();
  check(Mock::frames.size() == 2 && Mock::frames[0].data[3] == RECEIPT && Mock::frames[1].data[3] == CONTROL,
        "continuous receipts cannot starve a control command");
  Mock::now += GC::SEND_CALLBACK_TIMEOUT_MS;
  serviceRadio();
  check(!radioReady && !nodes[0].control.active, "lost send callback halts overlapping sends and fails pending command");
}

int main() {
  try {
    parserTests(); telemetryTests(); commandTests();
    std::cout << "Gateway firmware: " << checks << " checks passed (actual sketch + ArduinoJson).\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "FAIL after " << checks << " checks: " << error.what() << '\n';
    return 1;
  }
}
