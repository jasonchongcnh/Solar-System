#pragma once
#include <ArduinoJson.h>
#include <ArduinoMqttClient.h>
#include "MqttSettings.h"

// ArduinoJson normally accepts trailing input. Require exactly one JSON object.
struct SolarReader {
  const uint8_t *data; size_t length, position = 0;
  SolarReader(const uint8_t *p, size_t n) : data(p), length(n) {}
  int read() { return position < length ? data[position++] : -1; }
  size_t readBytes(char *out, size_t n) {
    if (n > length - position) n = length - position;
    memcpy(out, data + position, n); position += n; return n;
  }
};
inline bool solarJson(JsonDocument &doc, const uint8_t *data, size_t size) {
  if (!size || size > MC::MAX_FRAME) return false;
  SolarReader reader(data, size);
  if (deserializeJson(doc, reader, DeserializationOption::NestingLimit(4))) return false;
  while (reader.position < size && strchr(" \t\r\n", data[reader.position]) && data[reader.position]) ++reader.position;
  return reader.position == size && doc.is<JsonObject>();
}
inline bool solarUInt(JsonVariantConst value) { return value.is<uint32_t>() && !value.is<bool>(); }
inline bool solarId(JsonVariantConst value) {
  return solarUInt(value) && value.as<uint32_t>() >= 1 && value.as<uint32_t>() <= MC::MAX_NODES;
}
inline bool solarNewer(uint32_t a, uint32_t b) { return int32_t(a - b) > 0; }
inline bool solarRead(MqttClient &mqtt, int size, JsonDocument &doc) {
  const bool allowed = size > 0 && size <= int(MC::MAX_FRAME) && !mqtt.messageRetain();
  uint8_t buffer[MC::MAX_FRAME]; size_t count = 0;
  while (mqtt.available()) {
    const int c = mqtt.read();
    if (allowed && count < sizeof(buffer)) buffer[count++] = uint8_t(c);
  }
  return allowed && count == size_t(size) && solarJson(doc, buffer, count);
}
inline bool solarPublish(MqttClient &mqtt, const char *topic, const JsonDocument &doc) {
  char buffer[MC::MAX_FRAME + 1];
  const size_t needed = measureJson(doc);
  if (!mqtt.connected() || needed > MC::MAX_FRAME) return false;
  const size_t n = serializeJson(doc, buffer, sizeof(buffer));
  // Non-retained QoS 0. Commands use correlated application ACK + bounded retry.
  if (!mqtt.beginMessage(topic, (unsigned long)n, false, 0)) return false;
  if (mqtt.write((const uint8_t *)buffer, n) != n) { mqtt.stop(); return false; }
  return mqtt.endMessage() == 1;
}
inline void solarTopic(char *out, size_t size, unsigned id, const char *kind) {
  snprintf(out, size, "%s/nodes/%u/%s", MC::ROOT, id, kind);
}
