#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Point-to-point edge protocol, never a radio proximity estimate. This CRC and
// challenge exchange detect stale/corrupt data; they are not authentication.
namespace EdgeIdentity {
constexpr size_t FRAME_SIZE = 30;
struct Frame {
  uint8_t id = 0, side = 0, mac[6] = {};
  uint32_t boot = 0, challenge = 0, echo = 0, sequence = 0;
};
inline uint16_t crc16(const uint8_t *bytes, size_t length) {
  uint16_t crc = 0xffff;
  for (size_t i = 0; i < length; ++i) {
    crc ^= uint16_t(bytes[i]) << 8;
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (crc & 0x8000) ? uint16_t((crc << 1) ^ 0x1021) : uint16_t(crc << 1);
  }
  return crc;
}
inline void put32(uint8_t *p, uint32_t value) {
  for (unsigned i = 0; i < 4; ++i) p[i] = uint8_t(value >> (8 * i));
}
inline uint32_t get32(const uint8_t *p) {
  uint32_t value = 0;
  for (unsigned i = 0; i < 4; ++i) value |= uint32_t(p[i]) << (8 * i);
  return value;
}
inline bool validMac(const uint8_t *mac) {
  uint8_t any = 0, all = 0xff;
  for (unsigned i = 0; i < 6; ++i) { any |= mac[i]; all &= mac[i]; }
  return any && all != 0xff && !(mac[0] & 1);
}
inline void encode(const Frame &frame, uint8_t *bytes) {
  bytes[0] = 0x48; bytes[1] = 0x58; bytes[2] = 1;
  bytes[3] = frame.id; bytes[4] = frame.side; bytes[5] = 0;
  put32(bytes + 6, frame.boot); put32(bytes + 10, frame.challenge);
  put32(bytes + 14, frame.echo); put32(bytes + 18, frame.sequence);
  memcpy(bytes + 22, frame.mac, 6);
  const uint16_t crc = crc16(bytes, FRAME_SIZE - 2);
  bytes[28] = uint8_t(crc); bytes[29] = uint8_t(crc >> 8);
}
inline bool decode(const uint8_t *bytes, Frame &frame) {
  if (bytes[0] != 0x48 || bytes[1] != 0x58 || bytes[2] != 1 || bytes[5] ||
      bytes[3] < 1 || bytes[3] > 8 || bytes[4] >= 6 ||
      crc16(bytes, FRAME_SIZE - 2) != (uint16_t(bytes[28]) | uint16_t(bytes[29]) << 8)) return false;
  frame.id = bytes[3]; frame.side = bytes[4]; frame.boot = get32(bytes + 6);
  frame.challenge = get32(bytes + 10); frame.echo = get32(bytes + 14);
  frame.sequence = get32(bytes + 18); memcpy(frame.mac, bytes + 22, 6);
  return frame.boot && frame.challenge && frame.sequence && validMac(frame.mac);
}
class Parser {
 public:
  void reset() { length = 0; }
  bool feed(uint8_t byte, Frame &frame) {
    bytes[length++] = byte;
    while (length && (bytes[0] != 0x48 || (length > 1 && bytes[1] != 0x58))) discard();
    if (length < FRAME_SIZE) return false;
    if (decode(bytes, frame)) { length = 0; return true; }
    discard();
    while (length && (bytes[0] != 0x48 || (length > 1 && bytes[1] != 0x58))) discard();
    return false;
  }
 private:
  uint8_t bytes[FRAME_SIZE] = {}; size_t length = 0;
  void discard() { --length; memmove(bytes, bytes + 1, length); }
};
class Port {
 public:
  Frame peer;
  bool confirmed = false, candidate = false;
  uint32_t challenge = 0, lastSeen = 0, lastTransmit = 0;
  Parser parser;
  void reset(uint32_t randomValue) {
    const uint32_t previous = challenge;
    challenge = randomValue;
    if (!challenge || challenge == previous) { challenge = previous + 1; if (!challenge) challenge = 1; }
    confirmed = candidate = false; lastSeen = lastTransmit = 0;
    peer = Frame{}; parser.reset();
  }
  bool expire(uint32_t now, uint32_t timeout, uint32_t randomValue) {
    if (candidate && uint32_t(now - lastSeen) >= timeout) { reset(randomValue); return true; }
    return false;
  }
  bool receive(const Frame &frame, uint32_t now, uint8_t ownId, const uint8_t *ownMac,
               uint32_t randomValue) {
    if (!frame.boot || !frame.challenge || !frame.sequence || frame.id < 1 || frame.id > 8 ||
        frame.side >= 6 || !validMac(frame.mac) || frame.id == ownId || !memcmp(frame.mac, ownMac, 6)) return false;
    const bool same = candidate && peer.id == frame.id && peer.side == frame.side &&
      peer.boot == frame.boot && !memcmp(peer.mac, frame.mac, 6);
    if (same && int32_t(frame.sequence - peer.sequence) <= 0) return false;
    if (!same) {
      // Even a previous valid peer must prove it has received a NEW challenge.
      reset(randomValue); peer = frame; candidate = true; lastSeen = now;
      return true;
    }
    const bool before = confirmed;
    confirmed = frame.echo == challenge;
    const bool changed = before != confirmed || peer.challenge != frame.challenge;
    peer = frame; lastSeen = now;
    return changed;
  }
  Frame outgoing(uint8_t id, uint8_t side, uint32_t boot, const uint8_t *mac, uint32_t now) {
    Frame frame; frame.id = id; frame.side = side; frame.boot = boot;
    frame.challenge = challenge; frame.echo = candidate ? peer.challenge : 0;
    if (!++txSequence) ++txSequence;
    frame.sequence = txSequence; memcpy(frame.mac, mac, 6); lastTransmit = now;
    return frame;
  }
 private:
  uint32_t txSequence = 0;
};
}
