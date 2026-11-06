#pragma once
// Desktop adapters for the actual UNO MQTT sketch; no board IO is performed.
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <deque>
#include <string>
#include <vector>
#ifndef __has_include
#define __has_include(header) 0
#endif
using String = std::string;
constexpr int A0 = 0;
constexpr uint8_t D0 = 2, D1 = 3, D2 = 4, D3 = 5, D4 = 6, D5 = 7, D6 = 21, D7 = 20, D8 = 8;
constexpr uint8_t D9 = 9, D10 = 10;
constexpr int HIGH = 1, LOW = 0, INPUT = 0, INPUT_PULLUP = 2, OUTPUT = 1;
namespace Mock {
static uint32_t now = 100;
static int wifiStatus = 6, apResult = 7;
static unsigned apStarts = 0, stationStarts = 0, wifiEnds = 0, configCalls = 0;
static unsigned mqttAttempts = 0, mqttStops = 0, mqttPolls = 0;
static bool mqttConnectResult = true;
static std::string lastApSsid, lastBroker, lastStationSsid, lastStationPassword;
static unsigned gpioReads[40] = {}, gpioModes[40] = {}, gpioWrites[40] = {};
static int gpioLevels[40] = {};
static unsigned disconnects = 0;
static unsigned beginAPCalls = 0, modemBegins = 0, modeWrites = 0;
static unsigned apStations = 0, apHidden = 99, apChannel = 0;
static bool modemDebugDisabled = false, modeWriteResult = true, softApWriteResult = true;
static std::string softApResponse = "1";
static std::vector<std::string> modemCommands;
static bool persistent = true, autoReconnect = true;
static int stationMode = 0;
static uint16_t lastBrokerPort = 0;
struct Publish { std::string topic, payload; bool retained; };
static std::vector<Publish> published;
}
inline uint32_t millis() { return Mock::now; }
inline uint32_t micros() { return Mock::now * 1000; }
inline int analogRead(int) { return 123; }
inline void randomSeed(unsigned long) {}
inline long random(long low, long) { return low + 20; }
inline void delay(uint32_t ms) { Mock::now += ms; }
inline void pinMode(uint8_t pin, int) { ++Mock::gpioModes[pin]; }
inline int digitalRead(uint8_t pin) { ++Mock::gpioReads[pin]; return Mock::gpioLevels[pin]; }
inline void digitalWrite(uint8_t pin, int level) { ++Mock::gpioWrites[pin]; Mock::gpioLevels[pin] = level; }
struct MockSerial {
  std::string output; std::deque<char> input;
  void begin(unsigned long) {}
  int available() { return int(input.size()); }
  int read() { if (input.empty()) return -1; const char c = input.front(); input.pop_front(); return c; }
  size_t write(uint8_t c) { output += char(c); return 1; }
  size_t write(const uint8_t *p, size_t n) { output.append((const char *)p, n); return n; }
  void println() { output += '\n'; }
  void println(const char *p) { output += p; output += '\n'; }
};
static MockSerial Serial;
struct IPAddress {
  uint8_t bytes[4] = {};
  IPAddress() = default;
  IPAddress(uint8_t a, uint8_t b, uint8_t c, uint8_t d) : bytes{a,b,c,d} {}
  uint8_t operator[](unsigned i) const { return bytes[i]; }
  std::string toString() const {
    char out[16]; snprintf(out, sizeof(out), "%u.%u.%u.%u", bytes[0], bytes[1], bytes[2], bytes[3]); return out;
  }
  bool operator==(const IPAddress &other) const { return !memcmp(bytes, other.bytes, 4); }
  bool operator!=(const IPAddress &other) const { return !(*this == other); }
};
