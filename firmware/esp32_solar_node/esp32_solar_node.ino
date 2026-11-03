/* Six digital Hall sensors -> ESP-NOW -> USB gateway -> management console.
 * Requires a board variant defining D0-D8 and Arduino-ESP32 3.x.
 * Configure NodeConfig.h before flashing. No voltage/current/temperature sensors
 * are assumed, and no synthetic electrical measurements are transmitted.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_idf_version.h>
#include <driver/gpio.h>
#include "SolarProtocol.h"
#include "NodeConfig.h"

// On XIAO C3/S3, UART0 uses D6/D7. Keep Serial on native USB so it cannot drive
// those already-wired pins, including while the meaning of D6-D8 is unconfirmed.
#if (defined(CONFIG_IDF_TARGET_ESP32C3) || defined(CONFIG_IDF_TARGET_ESP32S3) || defined(CONFIG_IDF_TARGET_ESP32C6)) && !ARDUINO_USB_CDC_ON_BOOT
#error "Enable Tools > USB CDC On Boot; UART logging can conflict with wired D6/D7."
#endif

#if !ARDUINO_USB_CDC_ON_BOOT
constexpr bool pinsAvoidUart() {
  for (uint8_t pin : NodeConfig::HALL_PINS) if (pin == TX || pin == RX) return false;
  for (uint8_t pin : NodeConfig::HARDWARE_ID_PINS) if (pin == TX || pin == RX) return false;
  return NodeConfig::POWER_RELAY_PIN != TX && NodeConfig::POWER_RELAY_PIN != RX;
}
static_assert(pinsAvoidUart(), "Configured hardware pins overlap Serial UART. Use native USB or remap the pins.");
#endif

using namespace SolarProtocol;

constexpr uint8_t RX_CAPACITY = 8;
constexpr uint8_t ACK_CAPACITY = 8;
constexpr uint32_t RADIO_GAP_MS = 5;
struct RxFrame { uint8_t mac[6], length, data[MAX_PACKET_SIZE]; };
struct PendingAck { uint8_t mac[6]; ControlAck packet; };
struct HallInput { bool candidate, stable; uint32_t changedAt; };

portMUX_TYPE radioMux = portMUX_INITIALIZER_UNLOCKED;
RxFrame rxQueue[RX_CAPACITY];
uint8_t rxHead = 0, rxTail = 0, rxCount = 0;
bool txBusy = false, txCompleted = false;
uint8_t txBuffer[MAX_PACKET_SIZE];
PendingAck ackQueue[ACK_CAPACITY];
uint8_t ackHead = 0, ackTail = 0, ackCount = 0;
HallInput hallInputs[6];

bool ready = false, gatewayBound = false, haveCommand = false;
bool enabled = NodeConfig::POWER_RELAY_PIN < 0; // Monitoring is active without a relay.
bool telemetryDirty = false, telemetryRequested = false, telemetryOutstanding = false;
uint8_t nodeId = NodeConfig::MANUAL_NODE_ID, configBits = MANUAL_CONFIG, hallMask = 0;
uint8_t gatewayMac[6] = {}, telemetryAttempts = 0;
uint32_t bootId = 0, gatewayBootId = 0, nextSequence = 0;
uint32_t lastTelemetryAt = 0, nextPeriodicAt = 0, retryAt = 0, nextRadioAt = 0;
uint32_t lastUptimeTick = 0;
uint64_t elapsedUptimeMs = 0;
int8_t coordQ = 0, coordR = 0;
Telemetry currentTelemetry = {};
Control lastCommand = {};
ControlAck lastCommandAck = {};

bool timeReached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

bool isZeroMac(const uint8_t *mac) {
  uint8_t bits = 0;
  for (uint8_t i = 0; i < 6; ++i) bits |= mac[i];
  return bits == 0;
}

bool validSourceMac(const uint8_t *mac) {
  return mac && !isZeroMac(mac) && !(mac[0] & 1);
}

bool permittedGateway(const uint8_t *mac) {
  return validSourceMac(mac) && (isZeroMac(NodeConfig::GATEWAY_MAC) ||
         sameMac(mac, NodeConfig::GATEWAY_MAC));
}

void enqueueRx(const uint8_t *mac, const uint8_t *data, int length) {
  if (!mac || !data || length < static_cast<int>(sizeof(Header)) ||
      length > static_cast<int>(MAX_PACKET_SIZE)) return;
  portENTER_CRITICAL(&radioMux);
  if (rxCount < RX_CAPACITY) {
    RxFrame &frame = rxQueue[rxTail];
    memcpy(frame.mac, mac, 6);
    memcpy(frame.data, data, length);
    frame.length = static_cast<uint8_t>(length);
    rxTail = (rxTail + 1) % RX_CAPACITY;
    ++rxCount;
  }
  portEXIT_CRITICAL(&radioMux);
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int length) {
  if (info) enqueueRx(info->src_addr, data, length);
}
#else
void onReceive(const uint8_t *mac, const uint8_t *data, int length) {
  enqueueRx(mac, data, length);
}
#endif

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)
void onSent(const wifi_tx_info_t *, esp_now_send_status_t) {
#else
void onSent(const uint8_t *, esp_now_send_status_t) {
#endif
  portENTER_CRITICAL(&radioMux);
  txBusy = false;
  txCompleted = true;
  portEXIT_CRITICAL(&radioMux);
}

bool popRx(RxFrame &frame) {
  bool available = false;
  portENTER_CRITICAL(&radioMux);
  if (rxCount) {
    frame = rxQueue[rxHead];
    rxHead = (rxHead + 1) % RX_CAPACITY;
    --rxCount;
    available = true;
  }
  portEXIT_CRITICAL(&radioMux);
  return available;
}

bool ensurePeer(const uint8_t *mac) {
  if (esp_now_is_peer_exist(mac)) return true;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = RADIO_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  return esp_now_add_peer(&peer) == ESP_OK;
}

bool radioAvailable(uint32_t now) {
  portENTER_CRITICAL(&radioMux);
  const bool busy = txBusy;
  const bool completed = txCompleted;
  txCompleted = false;
  portEXIT_CRITICAL(&radioMux);
  if (completed) nextRadioAt = now + RADIO_GAP_MS;
  return !busy && timeReached(now, nextRadioAt);
}

bool startSend(const uint8_t *mac, const void *packet, size_t length, uint32_t now) {
  // Called only from loop(), after radioAvailable(). The callback releases busy.
  if (!ensurePeer(mac)) { nextRadioAt = now + 30; return false; }
  memcpy(txBuffer, packet, length);
  portENTER_CRITICAL(&radioMux);
  txBusy = true;
  portEXIT_CRITICAL(&radioMux);
  const esp_err_t result = esp_now_send(mac, txBuffer, length);
  if (result != ESP_OK) {
    portENTER_CRITICAL(&radioMux);
    txBusy = false; // No send callback is scheduled on synchronous failure.
    portEXIT_CRITICAL(&radioMux);
    nextRadioAt = now + 30;
    return false;
  }
  return true;
}

void queueAck(const uint8_t *mac, const ControlAck &packet) {
  if (ackCount >= ACK_CAPACITY) return;
  memcpy(ackQueue[ackTail].mac, mac, 6);
  ackQueue[ackTail].packet = packet;
  ackTail = (ackTail + 1) % ACK_CAPACITY;
  ++ackCount;
}

void acceptReceipt(const RxFrame &frame) {
  if (!validHeader(frame.data, frame.length, RECEIPT, sizeof(Receipt)) ||
      !telemetryOutstanding || !telemetryAttempts || !permittedGateway(frame.mac)) return;
  Receipt receipt;
  memcpy(&receipt, frame.data, sizeof(receipt));
  if (receipt.nodeId != nodeId || receipt.nodeBootId != bootId ||
      receipt.telemetrySequence != currentTelemetry.sequence || !receipt.gatewayBootId ||
      (gatewayBound && !sameMac(frame.mac, gatewayMac))) return;
  if (!ensurePeer(frame.mac)) return;
  // A lost link is not a new session: retain deduplication through rediscovery
  // of the same gateway boot so an old command cannot be applied a second time.
  const bool changedGateway = !sameMac(frame.mac, gatewayMac) ||
                              gatewayBootId != receipt.gatewayBootId;
  if (changedGateway) {
    haveCommand = false;
    ackHead = ackTail = ackCount = 0;
    Serial.printf("Gateway bound: %02X:%02X:%02X:%02X:%02X:%02X\n",
                  frame.mac[0], frame.mac[1], frame.mac[2], frame.mac[3], frame.mac[4], frame.mac[5]);
  }
  memcpy(gatewayMac, frame.mac, 6);
  gatewayBootId = receipt.gatewayBootId;
  gatewayBound = true;
  telemetryOutstanding = false;
}

void acceptControl(const RxFrame &frame) {
  if (!validHeader(frame.data, frame.length, CONTROL, sizeof(Control)) ||
      !gatewayBound || !sameMac(frame.mac, gatewayMac) || ackCount >= ACK_CAPACITY) return;
  Control command;
  memcpy(&command, frame.data, sizeof(command));
  if (command.targetId != nodeId || command.nodeBootId != bootId ||
      command.gatewayBootId != gatewayBootId) return;
  ControlAck ack = {header(CONTROL_ACK), nodeId, command.command, command.param,
                    BAD_COMMAND, static_cast<uint8_t>(enabled), bootId,
                    gatewayBootId, command.sequence};
  if (haveCommand && command.sequence == lastCommand.sequence) {
    // Reuse the original outcome only if the entire command is identical.
    if (command.command == lastCommand.command && command.param == lastCommand.param)
      ack = lastCommandAck;
    queueAck(frame.mac, ack);
    return;
  }
  if (haveCommand && !newer(command.sequence, lastCommand.sequence)) {
    ack.result = STALE_COMMAND;
    queueAck(frame.mac, ack);
    return;
  }
  if (command.command == SET_POWER && command.param <= 1) {
    if (NodeConfig::POWER_RELAY_PIN < 0) {
      ack.result = UNSUPPORTED;
    } else {
      enabled = command.param != 0;
      digitalWrite(NodeConfig::POWER_RELAY_PIN,
                   enabled == NodeConfig::RELAY_ACTIVE_HIGH ? HIGH : LOW);
      ack.result = APPLIED;
      telemetryRequested = true;
    }
  } else if (command.command == REQUEST_TELEMETRY && command.param == 0) {
    telemetryRequested = true;
    ack.result = APPLIED;
  }
  ack.enabled = static_cast<uint8_t>(enabled);
  lastCommand = command;
  lastCommandAck = ack;
  haveCommand = true;
  queueAck(frame.mac, ack);
}

void processReceived() {
  RxFrame frame;
  // Bound the work per iteration so noise cannot starve Hall input polling.
  for (uint8_t i = 0; i < RX_CAPACITY && popRx(frame); ++i) {
    acceptReceipt(frame);
    acceptControl(frame);
  }
}

void pollHallInputs(uint32_t now) {
  for (uint8_t i = 0; i < 6; ++i) {
    HallInput &input = hallInputs[i];
    const bool active = (digitalRead(NodeConfig::HALL_PINS[i]) == LOW) == NodeConfig::HALL_ACTIVE_LOW;
    if (active != input.candidate) {
      input.candidate = active;
      input.changedAt = now;
    } else if (active != input.stable && now - input.changedAt >= NodeConfig::HALL_DEBOUNCE_MS) {
      input.stable = active;
      if (active) hallMask |= (1U << i);
      else hallMask &= ~(1U << i);
      telemetryDirty = true;
    }
  }
}

void beginTelemetry(uint32_t now) {
  currentTelemetry = {};
  currentTelemetry.header = header(TELEMETRY);
  currentTelemetry.nodeId = nodeId;
  currentTelemetry.hallMask = hallMask;
  currentTelemetry.configBits = configBits;
  currentTelemetry.flags = (enabled ? ENABLED : 0) |
                           (NodeConfig::POWER_RELAY_PIN >= 0 ? POWER_CONTROL_AVAILABLE : 0);
  currentTelemetry.bootId = bootId;
  currentTelemetry.sequence = ++nextSequence;
  currentTelemetry.uptimeSec = static_cast<uint32_t>(elapsedUptimeMs / 1000);
  currentTelemetry.q = coordQ;
  currentTelemetry.r = coordR;
  telemetryOutstanding = true;
  telemetryAttempts = 0;
  telemetryDirty = telemetryRequested = false;
  lastTelemetryAt = now;
  nextPeriodicAt = now + NodeConfig::TELEMETRY_PERIOD_MS +
                   esp_random() % (NodeConfig::TELEMETRY_JITTER_MS + 1);
  retryAt = now;
}

void loseGateway(uint32_t now) {
  // Clear pending old commands; the next receipt re-establishes a boot session.
  if (gatewayBound) {
    esp_now_del_peer(gatewayMac);
    Serial.println("Gateway receipt timeout; rediscovering.");
  }
  gatewayBound = false;
  ackHead = ackTail = ackCount = 0;
  telemetryOutstanding = false;
  telemetryDirty = telemetryRequested = false;
  nextPeriodicAt = now + 150 + esp_random() % 300;
}

void serviceRadio(uint32_t now) {
  if (!radioAvailable(now)) return;
  if (ackCount) {
    PendingAck &ack = ackQueue[ackHead];
    // Lost ACKs are recovered when the gateway retries the same command.
    startSend(ack.mac, &ack.packet, sizeof(ack.packet), now);
    ackHead = (ackHead + 1) % ACK_CAPACITY;
    --ackCount;
    return;
  }
  if (telemetryOutstanding && timeReached(now, retryAt)) {
    if (telemetryAttempts > NodeConfig::MAX_TELEMETRY_RETRIES) {
      loseGateway(now);
      return;
    }
    const uint8_t *destination = gatewayBound ? gatewayMac : BROADCAST_MAC;
    startSend(destination, &currentTelemetry, sizeof(currentTelemetry), now);
    ++telemetryAttempts;
    retryAt = now + NodeConfig::RECEIPT_TIMEOUT_MS + esp_random() % 51;
    return;
  }
  const bool changed = telemetryDirty || telemetryRequested;
  if (!telemetryOutstanding && timeReached(now, nextPeriodicAt)) beginTelemetry(now);
  else if (!telemetryOutstanding && changed && now - lastTelemetryAt >= NodeConfig::CHANGE_MIN_INTERVAL_MS)
    beginTelemetry(now);
}

bool validatePinConfiguration() {
  uint8_t reserved[9];
  memcpy(reserved, NodeConfig::HALL_PINS, 6);
  memcpy(reserved + 6, NodeConfig::HARDWARE_ID_PINS, 3);
  if (NodeConfig::POWER_RELAY_PIN < -1 ||
      (NodeConfig::POWER_RELAY_PIN >= 0 && !GPIO_IS_VALID_OUTPUT_GPIO(NodeConfig::POWER_RELAY_PIN)))
    return false;
  for (uint8_t i = 0; i < 9; ++i) {
    if (!GPIO_IS_VALID_GPIO(reserved[i])) return false;
    if (NodeConfig::POWER_RELAY_PIN == reserved[i]) return false;
    for (uint8_t j = i + 1; j < 9; ++j) if (reserved[i] == reserved[j]) return false;
  }
  return validNodeId(NodeConfig::MANUAL_NODE_ID) &&
         (isZeroMac(NodeConfig::GATEWAY_MAC) || validSourceMac(NodeConfig::GATEWAY_MAC));
}

uint8_t readIdBits() {
  uint8_t bits = 0;
  for (uint8_t i = 0; i < 3; ++i)
    if (digitalRead(NodeConfig::HARDWARE_ID_PINS[i]) == LOW) bits |= (1U << i);
  return bits;
}

bool configureHardwareId() {
  if (!NodeConfig::USE_HARDWARE_ID) return true;
  for (uint8_t i = 0; i < 3; ++i)
    pinMode(NodeConfig::HARDWARE_ID_PINS[i], NodeConfig::ID_USE_PULLUP ? INPUT_PULLUP : INPUT);
  const uint32_t started = millis();
  uint32_t stableSince = started;
  uint8_t bits = readIdBits();
  while (millis() - started < NodeConfig::ID_TIMEOUT_MS) {
    const uint32_t now = millis();
    const uint8_t sample = readIdBits();
    if (sample != bits) { bits = sample; stableSince = now; }
    else if (now - stableSince >= NodeConfig::ID_STABLE_MS) {
      configBits = bits;
      nodeId = 1 + bits;
      return true;
    }
    delay(1);
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  // Validate before configuring outputs, so a relay typo cannot drive a sensor.
  if (!validatePinConfiguration()) { Serial.println("Invalid node pin/ID/MAC configuration."); return; }
  if (NodeConfig::POWER_RELAY_PIN >= 0) {
    digitalWrite(NodeConfig::POWER_RELAY_PIN, NodeConfig::RELAY_ACTIVE_HIGH ? LOW : HIGH);
    pinMode(NodeConfig::POWER_RELAY_PIN, OUTPUT);
  }
  if (!configureHardwareId()) { Serial.println("Hardware ID is unstable; radio disabled."); return; }
  defaultCoordinates(nodeId, coordQ, coordR);
  if (NodeConfig::USE_CUSTOM_COORDINATES) { coordQ = NodeConfig::COORD_Q; coordR = NodeConfig::COORD_R; }
  for (uint8_t i = 0; i < 6; ++i) {
    pinMode(NodeConfig::HALL_PINS[i], NodeConfig::HALL_USE_PULLUP ? INPUT_PULLUP : INPUT);
    const bool active = (digitalRead(NodeConfig::HALL_PINS[i]) == LOW) == NodeConfig::HALL_ACTIVE_LOW;
    hallInputs[i] = {active, active, millis()};
    if (active) hallMask |= (1U << i);
  }
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  if (!WiFi.mode(WIFI_STA) || !WiFi.setSleep(false) ||
      esp_wifi_set_channel(RADIO_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK) {
    Serial.println("Cannot configure fixed-channel Wi-Fi; radio disabled."); return;
  }
  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW initialization failed."); return; }
  if (esp_now_register_recv_cb(onReceive) != ESP_OK || esp_now_register_send_cb(onSent) != ESP_OK ||
      !ensurePeer(BROADCAST_MAC)) {
    esp_now_deinit();
    Serial.println("ESP-NOW callback/peer setup failed.");
    return;
  }
  do { bootId = esp_random(); } while (!bootId);
  const uint32_t now = millis();
  lastUptimeTick = now;
  elapsedUptimeMs = now;
  lastTelemetryAt = now;
  nextPeriodicAt = now + nodeId * 20 + esp_random() % 200;
  nextRadioAt = now;
  ready = true;
  Serial.printf("Hall node %u, STA %s, channel %u, ID source %s, relay %s\n", nodeId,
                WiFi.macAddress().c_str(), RADIO_CHANNEL,
                NodeConfig::USE_HARDWARE_ID ? "D6-D8" : "manual",
                NodeConfig::POWER_RELAY_PIN >= 0 ? "configured (OFF)" : "absent");
}

void loop() {
  if (!ready) { delay(100); return; }
  const uint32_t now = millis();
  elapsedUptimeMs += static_cast<uint32_t>(now - lastUptimeTick);
  lastUptimeTick = now;
  pollHallInputs(now);
  processReceived();
  serviceRadio(now);
  delay(1);
}
