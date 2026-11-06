#include <iostream>
#include <stdexcept>
#include "EdgeIdentity.h"
#include "Sc16is752.h"
static unsigned checks = 0;
void check(bool passed, const char *description) { ++checks; if (!passed) throw std::runtime_error(description); }
EdgeIdentity::Frame frame(unsigned id = 2) {
  EdgeIdentity::Frame value; value.id = uint8_t(id); value.side = 4;
  value.boot = 123; value.challenge = 456; value.sequence = 1;
  const uint8_t mac[6] = {2, 0, 0, 0, 0, uint8_t(id)}; memcpy(value.mac, mac, 6); return value;
}
void crc(uint8_t *bytes) {
  const uint16_t value = EdgeIdentity::crc16(bytes, 28); bytes[28] = uint8_t(value); bytes[29] = uint8_t(value >> 8);
}
void protocolTests() {
  using namespace EdgeIdentity;
  check(crc16(reinterpret_cast<const uint8_t *>("123456789"), 9) == 0x29b1, "CRC matches CCITT-FALSE reference vector");
  uint8_t bytes[FRAME_SIZE]; const Frame value = frame(); Frame decoded;
  encode(value, bytes);
  check(decode(bytes, decoded) && decoded.id == value.id && decoded.side == value.side &&
        decoded.challenge == value.challenge && decoded.boot == value.boot && !memcmp(decoded.mac, value.mac, 6), "fixed frame round-trips every identity field");
  for (unsigned i = 0; i < FRAME_SIZE; ++i) {
    encode(value, bytes); bytes[i] ^= 1;
    check(!decode(bytes, decoded), "single-bit corruption anywhere is rejected");
  }
  const unsigned offsets[] = {2, 3, 4, 5}; const uint8_t bad[] = {2, 9, 6, 1};
  for (unsigned i = 0; i < 4; ++i) {
    encode(value, bytes); bytes[offsets[i]] = bad[i]; crc(bytes);
    check(!decode(bytes, decoded), "unknown version, ID, edge and reserved values are rejected even with a valid CRC");
  }
  for (unsigned offset : {6U, 10U, 18U}) {
    encode(value, bytes); put32(bytes + offset, 0); crc(bytes);
    check(!decode(bytes, decoded), "zero boot, challenge or sequence cannot establish identity");
  }
  encode(value, bytes); memset(bytes + 22, 0xff, 6); crc(bytes);
  check(!decode(bytes, decoded), "broadcast MAC cannot become a peer identity");
  Parser parser; unsigned accepted = 0;
  const uint8_t noise[] = {0x58, 0x48, 0x48, 0x58, 0xff, 0x02, 0x48};
  for (uint8_t byte : noise) if (parser.feed(byte, decoded)) ++accepted;
  encode(value, bytes);
  for (unsigned repeat = 0; repeat < 2; ++repeat)
    for (uint8_t byte : bytes) if (parser.feed(byte, decoded)) ++accepted;
  check(accepted == 2, "stream parser recovers from noise and handles concatenated frames");
  parser.reset();
  for (unsigned i = 0; i < 14; ++i) check(!parser.feed(bytes[i], decoded), "partial frames are not accepted");
  parser.reset();
  for (unsigned i = 14; i < FRAME_SIZE; ++i) check(!parser.feed(bytes[i], decoded), "reset discards a truncated stale frame");
}
void handshakeTests() {
  using namespace EdgeIdentity;
  Port a, b; a.reset(100); b.reset(200);
  const uint8_t macA[6] = {2,0,0,0,0,1}, macB[6] = {2,0,0,0,0,2};
  uint32_t now = 10;
  const Frame helloA = a.outgoing(1, 0, 101, macA, now++);
  b.receive(helloA, now++, 2, macB, 201);
  check(b.candidate && !b.confirmed, "receiving an ID alone cannot confirm an edge");
  const Frame helloB = b.outgoing(2, 3, 202, macB, now++);
  a.receive(helloB, now++, 1, macA, 102);
  check(a.candidate && !a.confirmed, "first frame must echo a NEW challenge rather than one sent before peer discovery");
  const Frame responseA = a.outgoing(1, 0, 101, macA, now++);
  b.receive(responseA, now++, 2, macB, 203);
  const Frame responseB = b.outgoing(2, 3, 202, macB, now++);
  a.receive(responseB, now++, 1, macA, 103);
  check(a.confirmed && b.confirmed && a.peer.id == 2 && b.peer.id == 1, "independent endpoints converge to a reciprocal challenge-confirmed link");
  const uint32_t seen = a.lastSeen; const Frame replay = a.peer;
  a.receive(replay, now++, 1, macA, 500);
  check(a.lastSeen == seen, "replayed sequence cannot renew peer freshness");
  Frame newer = replay; ++newer.sequence; newer.echo = 0;
  a.receive(newer, now++, 1, macA, 501);
  check(!a.confirmed, "peer that stops echoing our challenge loses confirmation");
  newer.sequence++; newer.echo = a.challenge; a.receive(newer, now++, 1, macA, 502);
  check(a.confirmed, "a fresh valid response restores confirmation");
  newer.boot++; newer.sequence = 1; a.receive(newer, now++, 1, macA, 503);
  check(!a.confirmed && a.challenge == 503, "remote reboot rotates local challenge and requires a new round trip");
  newer.sequence++; newer.echo = a.challenge; a.receive(newer, now++, 1, macA, 504);
  check(a.confirmed, "rebooted peer confirms only after seeing the new challenge");
  check(!a.expire(a.lastSeen + 2999, 3000, 600) && a.confirmed, "peer remains current strictly inside timeout");
  check(a.expire(a.lastSeen + 3000, 3000, 601) && !a.confirmed && !a.candidate, "peer expires at timeout, including candidate state");
  const uint32_t oldChallenge = a.challenge; a.reset(oldChallenge);
  check(a.challenge && a.challenge != oldChallenge, "even repeated RNG output rotates an edge challenge");
  Frame self = frame(1); check(!a.receive(self, now++, 1, macA, 700) && !a.candidate, "duplicate own node ID is rejected");
  self = frame(2); memcpy(self.mac, macA, 6);
  check(!a.receive(self, now++, 1, macA, 701) && !a.candidate, "own MAC with a different ID is rejected");
  Frame wrap = frame(); wrap.sequence = 0xfffffffeU; a.receive(wrap, 0xfffffff0U, 1, macA, 702);
  wrap.sequence = 1; wrap.echo = a.challenge; a.receive(wrap, 0xfffffff8U, 1, macA, 703);
  check(a.confirmed, "sequence comparison handles 32-bit wraparound");
  check(a.expire(0x00000bb0U, 3000, 704), "freshness timeout handles millis rollover");
}
void driverTests() {
  MockWire::reset(); MockWire::chips[0x48].present = true;
  Sc16is752 uart(Wire);
  check(Sc16is752::selector(0, 3) == 0x18 && Sc16is752::selector(1, 3) == 0x1a, "I2C register and channel bits match NXP subaddress layout");
  check(uart.beginChip(0x48, 14745600, 9600), "SC16IS752 reset and scratch probe succeed");
  const auto &chip = MockWire::chips[0x48];
  for (unsigned channel = 0; channel < 2; ++channel) {
    check(chip.divisors[channel][0] == 96 && chip.divisors[channel][1] == 0, "divisor is programmed through DLAB on both channels");
    check(chip.regs[channel][3] == 3 && chip.regs[channel][4] == 0 && chip.regs[channel][1] == 0 &&
          chip.enhanced[channel] == 0x10 && chip.regs[channel][2] == 1, "8N1 FIFO enabled, flow control/loopback/IRQ disabled");
  }
  uint8_t input[64]; for (unsigned i = 0; i < 64; ++i) MockWire::chips[0x48].rx[1].push_back(uint8_t(i));
  size_t received = 0; const unsigned requests = MockWire::requests;
  check(uart.receive(0x48, 1, input, sizeof(input), received) && received == 64 && input[63] == 63 && MockWire::requests - requests == 5,
        "64-byte RX FIFO is drained in bounded I2C chunks of at most 30 bytes");
  bool sent = false;
  check(uart.transmit(0x48, 1, input, 30, sent) && sent && MockWire::chips[0x48].tx[1].size() == 30,
        "TX bytes go to the selected UART channel");
  MockWire::chips[0x48].rx[1].push_back(1);
  check(uart.flush(0x48, 1) && MockWire::chips[0x48].rx[1].empty() && MockWire::chips[0x48].tx[1].empty(), "flush clears stale RX and TX FIFOs");
  MockWire::chips[0x48].lineError[1] = 0x02;
  check(!uart.receive(0x48, 1, input, sizeof(input), received), "UART overrun invalidates the port instead of using buffered data");
  MockWire::chips[0x48].lineError[1] = 0; MockWire::shortRead = true;
  check(!uart.receive(0x48, 1, input, sizeof(input), received), "short I2C reads are errors");
  MockWire::shortRead = false; MockWire::chips[0x48].present = false;
  check(!uart.beginChip(0x48, 14745600, 9600), "missing UART chip cannot be reported ready");
  check(!uart.beginChip(0x48, 14745600, 0), "invalid baud configuration is rejected");
}
int main() {
  try { protocolTests(); handshakeTests(); driverTests(); std::cout << "Edge identity protocol/UART passed: " << checks << " checks\n"; }
  catch (const std::exception &error) { std::cerr << "Edge identity protocol/UART failed: " << error.what() << "\n"; return 1; }
}
