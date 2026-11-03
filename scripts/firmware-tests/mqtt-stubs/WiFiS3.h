#pragma once
#include "Arduino.h"
constexpr int WL_IDLE_STATUS = 0, WL_NO_SHIELD = 255, WL_NO_MODULE = 255, WL_CONNECTED = 3, WL_DISCONNECTED = 6;
constexpr int WL_AP_LISTENING = 7, WL_AP_CONNECTED = 8, WL_AP_FAILED = 9;
constexpr int WIFI_STA = 1;
struct WiFiClient {};
struct MockWiFi {
  IPAddress configured = {192,168,4,1};
  int status() { return Mock::wifiStatus; }
  int begin(const char *ssid, const char *password) {
    ++Mock::stationStarts; Mock::lastStationSsid = ssid; Mock::lastStationPassword = password;
    Mock::wifiStatus = WL_CONNECTED; return WL_CONNECTED;
  }
  void persistent(bool value) { Mock::persistent = value; }
  void setAutoReconnect(bool value) { Mock::autoReconnect = value; }
  void mode(int value) { Mock::stationMode = value; }
  int beginAP(const char *ssid, const char *, uint8_t = 1) {
    ++Mock::beginAPCalls; ++Mock::apStarts; Mock::lastApSsid = ssid; Mock::wifiStatus = Mock::apResult; return Mock::apResult;
  }
  void end() { ++Mock::wifiEnds; Mock::wifiStatus = WL_DISCONNECTED; }
  int disconnect() { Mock::wifiStatus = WL_DISCONNECTED; return 1; }
  int disconnect(bool, bool) { ++Mock::disconnects; return disconnect(); }
  void config(IPAddress address) { configured = address; ++Mock::configCalls; }
  template <typename... Args> void config(IPAddress address, Args...) { config(address); }
  IPAddress localIP() { return configured; }
  IPAddress subnetMask() { return {255,255,255,0}; }
  const char *firmwareVersion() { return "test"; }
  uint8_t *macAddress(uint8_t *out) { const uint8_t mac[] = {2,0,0,0,0,1}; memcpy(out, mac, 6); return out; }
  String macAddress() { return "02:00:00:00:00:01"; }
  int RSSI() { return -61; }
};
static MockWiFi WiFi;
