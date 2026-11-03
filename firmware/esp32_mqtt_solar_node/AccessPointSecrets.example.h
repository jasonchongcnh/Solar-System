#pragma once
// Use IDENTICAL AP settings on UNO and every XIAO. The AP password is 8–63 characters.
#define SOLAR_AP_SSID "HexagonSolar-UNO-R4"
#define SOLAR_AP_PASSWORD "hexagonsolar888"
// PC joins the UNO AP with this STATIC IPv4 address, subnet mask 255.255.255.0.
// Avoid .2: it may be leased to a XIAO by the AP's DHCP server.
#define SOLAR_AP_BROKER_HOST "192.168.4.250"
// 8 nodes + 1 broker PC. Use 10 if a separate phone must also join.
#define SOLAR_AP_MAX_STATIONS 9
// The bridge's CSV command requires SSID/password without commas/control characters.
