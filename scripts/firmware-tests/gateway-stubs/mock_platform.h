#pragma once
// Desktop-only adapters. Production sketch and ArduinoJson code remain unchanged.
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <deque>
#include <set>
#include <string>
#include <vector>

#define ESP_IDF_VERSION_VAL(a, b, c) (((a) << 16) | ((b) << 8) | (c))
#define ESP_IDF_VERSION ESP_IDF_VERSION_VAL(5, 5, 0)
#define portMUX_INITIALIZER_UNLOCKED 0
#define WIFI_AP_STA 3
#define WIFI_IF_STA 0
#define WIFI_SECOND_CHAN_NONE 0
#define WIFI_PS_NONE 0
#define pdTRUE 1
using portMUX_TYPE = int;
using esp_err_t = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = 1;
enum esp_now_send_status_t { ESP_NOW_SEND_SUCCESS, ESP_NOW_SEND_FAIL };
struct wifi_tx_info_t {};
struct wifi_pkt_rx_ctrl_t { int8_t rssi; };
struct esp_now_recv_info_t { const uint8_t *src_addr; wifi_pkt_rx_ctrl_t *rx_ctrl; };
struct esp_now_peer_info_t { uint8_t peer_addr[6]; int channel, ifidx; bool encrypt; };

namespace Mock {
struct Frame { std::vector<uint8_t> mac, data; };
static uint32_t now = 1000;
static esp_err_t sendResult = ESP_OK, peerResult = ESP_OK;
static std::vector<Frame> frames;
static std::set<std::string> peers;
static std::vector<std::string> wsMessages;
static int channel = 0;
}
inline uint32_t millis() { return Mock::now; }
inline void delay(uint32_t ms) { Mock::now += ms; }
inline uint32_t esp_random() { return 99; }
inline void portENTER_CRITICAL(portMUX_TYPE *) {}
inline void portEXIT_CRITICAL(portMUX_TYPE *) {}

struct MockSerial {
  std::string output;
  std::deque<char> input;
  void begin(unsigned long) {}
  int available() { return static_cast<int>(input.size()); }
  int read() { if (input.empty()) return -1; int c = input.front(); input.pop_front(); return c; }
  size_t write(const uint8_t *data, size_t size) { output.append(reinterpret_cast<const char *>(data), size); return size; }
  size_t write(char value) { output += value; return 1; }
};
static MockSerial Serial;
struct MockIP { std::string toString() const { return "192.168.4.1"; } };
struct MockWiFi {
  void persistent(bool) {}
  bool mode(int) { return true; }
  void setAutoReconnect(bool) {}
  void disconnect(bool, bool) {}
  bool softAP(const char *, const char *, int channel, bool, int) { Mock::channel = channel; return true; }
  void macAddress(uint8_t *out) { const uint8_t mac[] = {2, 3, 4, 5, 6, 7}; memcpy(out, mac, 6); }
  MockIP softAPIP() const { return {}; }
};
static MockWiFi WiFi;
inline esp_err_t esp_wifi_set_channel(int channel, int) { Mock::channel = channel; return ESP_OK; }
inline esp_err_t esp_wifi_set_ps(int) { return ESP_OK; }
inline esp_err_t esp_now_init() { return ESP_OK; }
inline esp_err_t esp_now_register_recv_cb(void (*)(const esp_now_recv_info_t *, const uint8_t *, int)) { return ESP_OK; }
inline esp_err_t esp_now_register_send_cb(void (*)(const wifi_tx_info_t *, esp_now_send_status_t)) { return ESP_OK; }
inline std::string macKey(const uint8_t *mac) { return std::string(reinterpret_cast<const char *>(mac), 6); }
inline bool esp_now_is_peer_exist(const uint8_t *mac) { return Mock::peers.count(macKey(mac)) != 0; }
inline esp_err_t esp_now_add_peer(const esp_now_peer_info_t *peer) {
  if (Mock::peerResult == ESP_OK) Mock::peers.insert(macKey(peer->peer_addr));
  return Mock::peerResult;
}
inline esp_err_t esp_now_del_peer(const uint8_t *mac) { Mock::peers.erase(macKey(mac)); return ESP_OK; }
inline esp_err_t esp_now_send(const uint8_t *mac, const uint8_t *data, size_t length) {
  Mock::Frame frame;
  frame.mac.assign(mac, mac + 6);
  frame.data.assign(data, data + length);
  Mock::frames.push_back(frame);
  return Mock::sendResult;
}

struct MockQueue { size_t capacity, itemSize; std::deque<std::vector<uint8_t>> items; };
using QueueHandle_t = MockQueue *;
inline QueueHandle_t xQueueCreate(size_t capacity, size_t itemSize) {
  return new MockQueue{capacity, itemSize, {}};
}
inline int xQueueSend(QueueHandle_t queue, const void *item, int) {
  if (queue->items.size() >= queue->capacity) return 0;
  const uint8_t *bytes = static_cast<const uint8_t *>(item);
  queue->items.emplace_back(bytes, bytes + queue->itemSize);
  return pdTRUE;
}
inline int xQueueReceive(QueueHandle_t queue, void *item, int) {
  if (queue->items.empty()) return 0;
  memcpy(item, queue->items.front().data(), queue->itemSize);
  queue->items.pop_front();
  return pdTRUE;
}

enum WStype_t { WStype_CONNECTED, WStype_TEXT, WStype_FRAGMENT_TEXT_START,
                 WStype_FRAGMENT_BIN_START, WStype_BIN };
class WebSocketsServer {
 public:
  explicit WebSocketsServer(uint16_t) {}
  void begin() {}
  void loop() {}
  void onEvent(void (*)(uint8_t, WStype_t, uint8_t *, size_t)) {}
  void enableHeartbeat(uint32_t, uint32_t, uint8_t) {}
  void disconnect(uint8_t) {}
  bool broadcastTXT(char *text, size_t length) { Mock::wsMessages.emplace_back(text, length); return true; }
};
