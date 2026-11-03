#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <string>
#include <vector>
#include <algorithm>

#define ARDUINO_USB_CDC_ON_BOOT 1
#define CONFIG_IDF_TARGET_ESP32C3 1
#define ESP_IDF_VERSION_VAL(a,b,c) (((a) << 16) | ((b) << 8) | (c))
#define ESP_IDF_VERSION ESP_IDF_VERSION_VAL(5,5,0)
inline bool mockValidGpio(int pin) { return pin >= 0 && pin < 22; }
#define GPIO_IS_VALID_GPIO(pin) mockValidGpio(pin)
#define GPIO_IS_VALID_OUTPUT_GPIO(pin) GPIO_IS_VALID_GPIO(pin)
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(mux) ((void)(mux))
#define portEXIT_CRITICAL(mux) ((void)(mux))
using portMUX_TYPE = int;
constexpr uint8_t D0=2, D1=3, D2=4, D3=5, D4=6, D5=7, D6=21, D7=20, D8=8;
constexpr int TX=21, RX=20, LOW=0, HIGH=1, INPUT=0, INPUT_PULLUP=2, OUTPUT=1;
constexpr int WIFI_STA=1, WIFI_IF_STA=0, WIFI_SECOND_CHAN_NONE=0;
using esp_err_t = int;
constexpr esp_err_t ESP_OK=0;
enum esp_now_send_status_t { ESP_NOW_SEND_SUCCESS, ESP_NOW_SEND_FAIL };
struct wifi_tx_info_t {};
struct esp_now_recv_info_t { const uint8_t *src_addr; };
struct esp_now_peer_info_t { uint8_t peer_addr[6]; uint8_t channel; int ifidx; bool encrypt; };
struct MockSent { std::vector<uint8_t> mac, data; };
uint32_t mockMillis = 0, mockRandom = 100;
int mockPinLevels[64], mockPinModes[64], mockPinWrites[64];
bool mockWifiOk = true;
esp_err_t mockEspInitResult=ESP_OK, mockSendResult=ESP_OK;
std::vector<MockSent> mockSent;
uint32_t millis() { return mockMillis; }
void delay(uint32_t ms) { mockMillis += ms; }
int digitalRead(int pin) { return mockPinLevels[pin]; }
void digitalWrite(int pin, int level) { mockPinLevels[pin]=level; ++mockPinWrites[pin]; }
void pinMode(int pin, int mode) { mockPinModes[pin]=mode; }
uint32_t esp_random() { return ++mockRandom; }
struct MockSerial {
  void begin(int) {}
  void println(const char *) {}
  template<typename... Args> void printf(const char *, Args...) {}
} Serial;
struct MockWiFi {
  void persistent(bool) {}
  void setAutoReconnect(bool) {}
  bool mode(int) { return mockWifiOk; }
  bool setSleep(bool) { return true; }
  std::string macAddress() { return "02:00:00:00:00:01"; }
} WiFi;
esp_err_t esp_wifi_set_channel(uint8_t, int) { return ESP_OK; }
esp_err_t esp_now_init() { return mockEspInitResult; }
esp_err_t esp_now_deinit() { return ESP_OK; }
esp_err_t esp_now_register_recv_cb(void (*)(const esp_now_recv_info_t*, const uint8_t*, int)) { return ESP_OK; }
esp_err_t esp_now_register_send_cb(void (*)(const wifi_tx_info_t*, esp_now_send_status_t)) { return ESP_OK; }
bool esp_now_is_peer_exist(const uint8_t *) { return true; }
esp_err_t esp_now_add_peer(const esp_now_peer_info_t *) { return ESP_OK; }
esp_err_t esp_now_del_peer(const uint8_t *) { return ESP_OK; }
esp_err_t esp_now_send(const uint8_t *mac, const uint8_t *data, size_t length) {
  if (mockSendResult == ESP_OK)
    mockSent.push_back({std::vector<uint8_t>(mac, mac+6), std::vector<uint8_t>(data, data+length)});
  return mockSendResult;
}
