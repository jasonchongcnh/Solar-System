#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Wire protocol for this project, independent of the ESP-NOW radio version.
// Keep this file byte-for-byte identical in the two sketch directories.
namespace SolarProtocol {
constexpr uint16_t MAGIC = 0x5348;
constexpr uint8_t VERSION = 1;
constexpr uint8_t MAX_NODES = 8;
constexpr uint8_t RADIO_CHANNEL = 1;
constexpr uint8_t MANUAL_CONFIG = 0xff;
constexpr uint8_t BROADCAST_MAC[6] = {255, 255, 255, 255, 255, 255};
enum PacketType : uint8_t { TELEMETRY = 1, RECEIPT = 2, CONTROL = 3, CONTROL_ACK = 4 };
enum Command : uint8_t { SET_POWER = 1, REQUEST_TELEMETRY = 2 };
enum Result : uint8_t { APPLIED = 0, UNSUPPORTED = 1, BAD_COMMAND = 2, STALE_COMMAND = 3 };
enum Flags : uint8_t { ENABLED = 1, POWER_CONTROL_AVAILABLE = 2 };

struct __attribute__((packed)) Header { uint16_t magic; uint8_t version; uint8_t type; };
struct __attribute__((packed)) Telemetry {
  Header header;
  uint8_t nodeId, hallMask, configBits, flags;
  uint32_t bootId, sequence, uptimeSec;
  int8_t q, r;
};
struct __attribute__((packed)) Receipt {
  Header header;
  uint8_t nodeId;
  uint32_t nodeBootId, telemetrySequence, gatewayBootId;
};
struct __attribute__((packed)) Control {
  Header header;
  uint8_t targetId, command, param;
  uint32_t nodeBootId, gatewayBootId, sequence;
};
struct __attribute__((packed)) ControlAck {
  Header header;
  uint8_t nodeId, command, param, result, enabled;
  uint32_t nodeBootId, gatewayBootId, sequence;
};
static_assert(sizeof(Header) == 4, "Unexpected wire header layout");
static_assert(sizeof(Telemetry) == 22, "Unexpected telemetry layout");
static_assert(sizeof(Receipt) == 17, "Unexpected receipt layout");
static_assert(sizeof(Control) == 19, "Unexpected control layout");
static_assert(sizeof(ControlAck) == 21, "Unexpected ACK layout");
constexpr size_t MAX_PACKET_SIZE = sizeof(Telemetry);

inline Header header(PacketType type) { return {MAGIC, VERSION, static_cast<uint8_t>(type)}; }
inline bool validHeader(const uint8_t *data, size_t length, PacketType type, size_t expected) {
  if (!data || length != expected) return false;
  Header h;
  memcpy(&h, data, sizeof(h));
  return h.magic == MAGIC && h.version == VERSION && h.type == type;
}
inline bool validNodeId(uint8_t id) { return id >= 1 && id <= MAX_NODES; }
inline bool newer(uint32_t candidate, uint32_t previous) {
  return static_cast<int32_t>(candidate - previous) > 0;
}
inline bool sameMac(const uint8_t *a, const uint8_t *b) { return memcmp(a, b, 6) == 0; }
inline void defaultCoordinates(uint8_t id, int8_t &q, int8_t &r) {
  static const int8_t coords[MAX_NODES][2] = {{0,0},{1,0},{0,1},{-1,1},{-1,0},{0,-1},{1,-1},{2,-1}};
  q = validNodeId(id) ? coords[id - 1][0] : 0;
  r = validNodeId(id) ? coords[id - 1][1] : 0;
}
} // namespace SolarProtocol
