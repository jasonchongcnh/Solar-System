#pragma once
#include <stdint.h>
#include <stddef.h>

namespace GatewayConfig {
// Change the password before operating outside a supervised demonstration.
constexpr char AP_SSID[] = "HexagonSolar-BaseGateway";
constexpr char AP_PASSWORD[] = "hexagonsolar888";
constexpr uint16_t WEBSOCKET_PORT = 81;
constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t NODE_TIMEOUT_MS = 15000;
constexpr uint32_t HEARTBEAT_MS = 5000;
constexpr uint32_t CONTROL_ACK_MS = 750;
constexpr uint8_t CONTROL_ATTEMPTS = 3;
constexpr uint32_t SEND_CALLBACK_TIMEOUT_MS = 2000;
constexpr size_t COMMAND_BYTES = 512;
constexpr uint8_t RX_QUEUE_LENGTH = 32;
// The channel is SolarProtocol::RADIO_CHANNEL in both sketches. Connecting the
// gateway STA interface to a router would change it, so this firmware does not.
} // namespace GatewayConfig
