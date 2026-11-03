#pragma once
#include "Arduino.h"
class MqttClient {
public:
  bool live = false, retained = false;
  std::string topic, incoming, txTopic, txPayload;
  size_t position = 0;
  bool txRetained = false;
  void (*callback)(int) = nullptr;
  explicit MqttClient(WiFiClient &) {}
  void setId(const char *) {}
  void setUsernamePassword(const char *, const char *) {}
  void setConnectionTimeout(unsigned long) {}
  void setKeepAliveInterval(unsigned long) {}
  void setCleanSession(bool) {}
  void onMessage(void (*handler)(int)) { callback = handler; }
  int beginWill(const char *, bool, uint8_t) { return 1; }
  int endWill() { return 1; }
  int connect(const char *host, uint16_t port) {
    ++Mock::mqttAttempts; Mock::lastBroker = host; Mock::lastBrokerPort = port;
    live = Mock::mqttConnectResult; return live;
  }
  int connected() { return live; }
  void stop() { ++Mock::mqttStops; live = false; }
  void poll() { ++Mock::mqttPolls; }
  int subscribe(const char *, uint8_t) { return 1; }
  int beginMessage(const char *name, unsigned long, bool retain, uint8_t) {
    txTopic = name; txPayload.clear(); txRetained = retain; return live;
  }
  int beginMessage(const char *name, bool retain, uint8_t) {
    return beginMessage(name, 0UL, retain, 0);
  }
  size_t write(const uint8_t *data, size_t n) { txPayload.append((const char *)data, n); return n; }
  size_t print(const char *p) { txPayload += p; return strlen(p); }
  int endMessage() { if (live) Mock::published.push_back({txTopic, txPayload, txRetained}); return live; }
  int available() { return int(incoming.size() - position); }
  int read() { return position < incoming.size() ? uint8_t(incoming[position++]) : -1; }
  String messageTopic() const { return topic; }
  bool messageRetain() const { return retained; }
};
