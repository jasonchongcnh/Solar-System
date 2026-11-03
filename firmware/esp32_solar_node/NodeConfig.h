#pragma once
#include <Arduino.h>

// Select the EXACT physical board in Arduino IDE. D0 is a board label, not GPIO0.
// The six sensor outputs must be digital and safe for 3.3 V ESP32 inputs.
namespace NodeConfig {
constexpr uint8_t HALL_PINS[6] = {D0, D1, D2, D3, D4, D5};
constexpr bool HALL_ACTIVE_LOW = true;
constexpr bool HALL_USE_PULLUP = true;  // Suitable for switches/open-collector outputs.
constexpr uint32_t HALL_DEBOUNCE_MS = 25;

// D6-D8 are reserved, but their actual circuit has not yet been confirmed.
// Leave false until they are confirmed to be three active-low ID straps.
// When false the firmware neither reads nor configures these three pins.
constexpr bool USE_HARDWARE_ID = false;
constexpr uint8_t MANUAL_NODE_ID = 1;  // Assign a DIFFERENT ID (1-8) to every node.
constexpr uint8_t HARDWARE_ID_PINS[3] = {D6, D7, D8};
// Optional confirmed strap mode: D6=bit0, D7=bit1, D8=bit2; LOW=1.
// ID = 1 + bits. All open = ID1; all grounded = ID8. Read once at startup.
constexpr bool ID_USE_PULLUP = true;
constexpr uint32_t ID_STABLE_MS = 50;
constexpr uint32_t ID_TIMEOUT_MS = 1000;

// No relay has been confirmed. A real relay can use an otherwise unused GPIO.
// All D0-D8 pins are reserved. Power always starts OFF when a relay is configured.
constexpr int POWER_RELAY_PIN = -1;
constexpr bool RELAY_ACTIVE_HIGH = true;

constexpr bool USE_CUSTOM_COORDINATES = false;
constexpr int8_t COORD_Q = 0;
constexpr int8_t COORD_R = 0;

// Optional gateway STATION MAC restriction; all zero = learn a gateway.
// This is an unencrypted trusted-bench protocol. A MAC filter is not authentication.
constexpr uint8_t GATEWAY_MAC[6] = {0, 0, 0, 0, 0, 0};
constexpr uint32_t TELEMETRY_PERIOD_MS = 1000;
constexpr uint32_t TELEMETRY_JITTER_MS = 200;
constexpr uint32_t CHANGE_MIN_INTERVAL_MS = 80;
constexpr uint32_t RECEIPT_TIMEOUT_MS = 300;
constexpr uint8_t MAX_TELEMETRY_RETRIES = 3;
}
