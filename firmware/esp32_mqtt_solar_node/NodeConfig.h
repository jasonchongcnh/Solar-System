#pragma once
#include <Arduino.h>

#ifndef SOLAR_EDGE_IDENTITY_ENABLED
#define SOLAR_EDGE_IDENTITY_ENABLED 0
#endif
#ifndef SOLAR_EDGE_SDA_PIN
#define SOLAR_EDGE_SDA_PIN D9
#endif
#ifndef SOLAR_EDGE_SCL_PIN
#define SOLAR_EDGE_SCL_PIN D10
#endif

// Select the EXACT physical board in Arduino IDE. D0 is a board label, not GPIO0.
// The six sensor outputs must be digital and safe for 3.3 V ESP32 inputs.
namespace NodeConfig {
constexpr uint8_t HALL_PINS[6] = {D0, D1, D2, D3, D4, D5};
constexpr bool HALL_ACTIVE_LOW = true;
constexpr bool HALL_USE_PULLUP = true;  // Suitable for switches/open-collector outputs.
constexpr uint32_t HALL_DEBOUNCE_MS = 25;

// Automatic identity requires three SC16IS752 dual UARTs and separate 3.3 V
// TX/RX/GND contacts on EACH edge. Match chip A/B ports to Hall D0/D1, D2/D3,
// D4/D5. Cross TX to the mating edge's RX. Keep disabled until hardware exists.
constexpr bool EDGE_IDENTITY_ENABLED = SOLAR_EDGE_IDENTITY_ENABLED != 0;
constexpr uint8_t EDGE_SDA_PIN = SOLAR_EDGE_SDA_PIN, EDGE_SCL_PIN = SOLAR_EDGE_SCL_PIN;
// A1/A0 straps: VDD/VDD, VDD/GND, GND/VDD (seven-bit addresses).
constexpr uint8_t EDGE_UART_ADDRESSES[3] = {0x48, 0x49, 0x4c};
constexpr uint32_t EDGE_UART_XTAL_HZ = 14745600; // MUST match the installed crystal.
constexpr uint32_t EDGE_UART_BAUD = 9600;
constexpr uint32_t EDGE_TX_PERIOD_MS = 750;
constexpr uint32_t EDGE_PEER_TIMEOUT_MS = 3000;
constexpr uint32_t EDGE_MAX_SERVICE_GAP_MS = 250;
constexpr uint32_t EDGE_RETRY_MS = 3000;

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

// MQTT topics and gateway identity are configured in MqttSettings.h.
constexpr uint32_t TELEMETRY_PERIOD_MS = 1000;
constexpr uint32_t CHANGE_MIN_INTERVAL_MS = 80;
}
