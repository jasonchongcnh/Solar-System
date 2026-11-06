#pragma once
#include <Arduino.h>
#include <Wire.h>

// NXP SC16IS752/762 Rev 9.1, sections 7.8, 8 and 10.4. All addresses
// supplied here are SEVEN-bit Wire addresses, not the datasheet's 8-bit bytes.
class Sc16is752 {
 public:
  explicit Sc16is752(TwoWire &bus) : wire(bus) {}
  static uint8_t selector(uint8_t channel, uint8_t reg) { return uint8_t((reg << 3) | (channel << 1)); }
  bool readRegister(uint8_t address, uint8_t channel, uint8_t reg, uint8_t &value) {
    return readBytes(address, selector(channel, reg), &value, 1);
  }
  bool writeRegister(uint8_t address, uint8_t channel, uint8_t reg, uint8_t value) {
    return writeBytes(address, selector(channel, reg), &value, 1);
  }
  bool beginChip(uint8_t address, uint32_t crystal, uint32_t baud) {
    if (!baud || crystal < baud * 16UL) return false;
    const uint32_t divisor = (crystal + baud * 8UL) / (baud * 16UL);
    if (!divisor || divisor > 65535) return false;
    if (!writeRegister(address, 0, 0x0e, 0x08)) return false; // reset both UARTs
    for (uint8_t channel = 0; channel < 2; ++channel) {
      uint8_t probe = 0;
      if (!writeRegister(address, channel, 3, 0x03) ||
          !writeRegister(address, channel, 7, 0xa5) || !readRegister(address, channel, 7, probe) || probe != 0xa5 ||
          !writeRegister(address, channel, 7, 0x5a) || !readRegister(address, channel, 7, probe) || probe != 0x5a ||
          !writeRegister(address, channel, 3, 0xbf) || // enhanced register bank
          !writeRegister(address, channel, 2, 0x10) || // enhanced access, no flow control
          !writeRegister(address, channel, 3, 0x00) ||
          !writeRegister(address, channel, 1, 0x00) || // IRQ and sleep disabled
          !writeRegister(address, channel, 4, 0x00) || // prescaler 1, loopback off
          !writeRegister(address, channel, 0x0f, 0x00) ||
          !writeRegister(address, channel, 3, 0x80) || // divisor bank
          !writeRegister(address, channel, 0, uint8_t(divisor)) ||
          !writeRegister(address, channel, 1, uint8_t(divisor >> 8)) ||
          !writeRegister(address, channel, 3, 0x03) || // 8N1
          !flush(address, channel) ||
          !readRegister(address, channel, 3, probe) || probe != 0x03) return false;
    }
    return true;
  }
  bool flush(uint8_t address, uint8_t channel) {
    return writeRegister(address, channel, 2, 0x07) && writeRegister(address, channel, 2, 0x01);
  }
  bool receive(uint8_t address, uint8_t channel, uint8_t *bytes, size_t capacity, size_t &count) {
    count = 0; uint8_t status = 0, available = 0;
    if (!readRegister(address, channel, 5, status) || (status & 0x9e) ||
        !readRegister(address, channel, 9, available) || available > 64) return false;
    const size_t total = available < capacity ? available : capacity;
    while (count < total) {
      const size_t chunk = total - count > 30 ? 30 : total - count;
      if (!readBytes(address, selector(channel, 0), bytes + count, chunk)) return false;
      count += chunk;
    }
    return true;
  }
  bool transmit(uint8_t address, uint8_t channel, const uint8_t *bytes, size_t length, bool &sent) {
    sent = false; uint8_t free = 0;
    if (length > 64 || !readRegister(address, channel, 8, free) || free > 64) return false;
    if (free < length) return true; // retry later; never block waiting for TX
    if (!writeBytes(address, selector(channel, 0), bytes, length)) return false;
    sent = true; return true;
  }
 private:
  TwoWire &wire;
  bool readBytes(uint8_t address, uint8_t reg, uint8_t *bytes, size_t length) {
    wire.beginTransmission(address);
    if (wire.write(reg) != 1 || wire.endTransmission(false) != 0) return false;
    if (wire.requestFrom(address, uint8_t(length)) != length) return false;
    for (size_t i = 0; i < length; ++i) { const int value = wire.read(); if (value < 0) return false; bytes[i] = uint8_t(value); }
    return true;
  }
  bool writeBytes(uint8_t address, uint8_t reg, const uint8_t *bytes, size_t length) {
    wire.beginTransmission(address);
    if (wire.write(reg) != 1 || wire.write(bytes, length) != length) { wire.endTransmission(); return false; }
    return wire.endTransmission() == 0;
  }
};
