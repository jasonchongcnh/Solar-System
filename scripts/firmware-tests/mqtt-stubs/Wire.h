#pragma once
#include "Arduino.h"
namespace MockWire {
struct Chip {
  bool present = false;
  uint8_t regs[2][16] = {}, divisors[2][2] = {}, enhanced[2] = {};
  std::deque<uint8_t> rx[2];
  std::vector<uint8_t> tx[2];
  uint8_t lineError[2] = {};
};
struct Write { uint8_t address, selector; std::vector<uint8_t> bytes; };
static Chip chips[128];
static std::vector<Write> writes;
static unsigned beginCalls = 0, requests = 0;
static int sda = -1, scl = -1;
static uint32_t clock = 0; static uint16_t timeout = 0;
static bool beginResult = true, failTransactions = false, shortRead = false;
inline void reset() {
  for (Chip &chip : chips) chip = Chip{};
  writes.clear(); beginCalls = requests = 0; sda = scl = -1;
  clock = timeout = 0; beginResult = true; failTransactions = shortRead = false;
}
inline uint8_t read(uint8_t address, uint8_t selector) {
  Chip &chip = chips[address]; const unsigned channel = (selector >> 1) & 1, reg = (selector >> 3) & 15;
  const uint8_t lcr = chip.regs[channel][3];
  if ((lcr & 0x80) && lcr != 0xbf && reg <= 1) return chip.divisors[channel][reg];
  if (lcr == 0xbf && reg == 2) return chip.enhanced[channel];
  if (reg == 0) { if (chip.rx[channel].empty()) return 0; const uint8_t byte = chip.rx[channel].front(); chip.rx[channel].pop_front(); return byte; }
  if (reg == 5) return uint8_t(0x60 | chip.lineError[channel] | (!chip.rx[channel].empty() ? 1 : 0));
  if (reg == 8) return 64;
  if (reg == 9) return uint8_t(chip.rx[channel].size());
  return chip.regs[channel][reg];
}
inline void write(uint8_t address, uint8_t selector, uint8_t byte) {
  Chip &chip = chips[address]; const unsigned channel = (selector >> 1) & 1, reg = (selector >> 3) & 15;
  const uint8_t lcr = chip.regs[channel][3];
  if (reg == 0x0e && (byte & 0x08)) {
    const bool present = chip.present; chip = Chip{}; chip.present = present; return;
  }
  if ((lcr & 0x80) && lcr != 0xbf && reg <= 1) { chip.divisors[channel][reg] = byte; return; }
  if (lcr == 0xbf && reg == 2) { chip.enhanced[channel] = byte; return; }
  if (reg == 0) { chip.tx[channel].push_back(byte); return; }
  if (reg == 2) {
    if (byte & 2) { chip.rx[channel].clear(); chip.lineError[channel] = 0; }
    if (byte & 4) chip.tx[channel].clear();
  }
  chip.regs[channel][reg] = byte;
}
}
class TwoWire {
 public:
  bool begin(int sda, int scl, uint32_t clock = 100000) {
    ++MockWire::beginCalls; MockWire::sda = sda; MockWire::scl = scl; MockWire::clock = clock; return MockWire::beginResult;
  }
  void setTimeOut(uint16_t timeout) { MockWire::timeout = timeout; }
  void beginTransmission(uint8_t address) { target = address; outgoing.clear(); }
  size_t write(uint8_t value) { outgoing.push_back(value); return 1; }
  size_t write(const uint8_t *bytes, size_t length) { outgoing.insert(outgoing.end(), bytes, bytes + length); return length; }
  uint8_t endTransmission(bool = true) {
    if (target >= 128 || !MockWire::chips[target].present || MockWire::failTransactions) return 2;
    if (outgoing.empty()) return 4;
    selected = outgoing[0];
    if (outgoing.size() > 1) {
      MockWire::writes.push_back({target, selected, std::vector<uint8_t>(outgoing.begin() + 1, outgoing.end())});
      for (size_t i = 1; i < outgoing.size(); ++i) MockWire::write(target, selected, outgoing[i]);
    }
    return 0;
  }
  size_t requestFrom(uint8_t address, uint8_t length) {
    ++MockWire::requests; incoming.clear();
    if (address >= 128 || !MockWire::chips[address].present || MockWire::failTransactions) return 0;
    if (MockWire::shortRead && length) --length;
    for (unsigned i = 0; i < length; ++i) incoming.push_back(MockWire::read(address, selected));
    return length;
  }
  int read() { if (incoming.empty()) return -1; const uint8_t byte = incoming.front(); incoming.pop_front(); return byte; }
 private:
  uint8_t target = 0, selected = 0;
  std::vector<uint8_t> outgoing; std::deque<uint8_t> incoming;
};
static TwoWire Wire;
