#pragma once
#include <IPAddress.h>
#include <string.h>
// AP settings are separate from old router credentials in Secrets.h.
// Copy AccessPointSecrets.example.h to ignored AccessPointSecrets.h in BOTH sketches.
#if !defined(SOLAR_USE_EXAMPLE_SETTINGS) && __has_include("AccessPointSecrets.h")
#include "AccessPointSecrets.h"
#endif
#ifndef SOLAR_AP_SSID
#define SOLAR_AP_SSID "HexagonSolar-UNO-R4"
#endif
#ifndef SOLAR_AP_PASSWORD
#define SOLAR_AP_PASSWORD "hexagonsolar888"
#endif
#ifndef SOLAR_AP_BROKER_HOST
#define SOLAR_AP_BROKER_HOST "192.168.4.250"
#endif
#ifndef SOLAR_AP_MAX_STATIONS
#define SOLAR_AP_MAX_STATIONS 9
#endif
namespace APConfig {
constexpr char SSID[] = SOLAR_AP_SSID;
constexpr char PASSWORD[] = SOLAR_AP_PASSWORD;
// The PC running Mosquitto joins this AP with a static address outside its DHCP pool.
constexpr char BROKER_HOST[] = SOLAR_AP_BROKER_HOST;
// Eight XIAOs + one broker computer. Set 10 to reserve a separate phone slot.
constexpr unsigned MAX_STATIONS = SOLAR_AP_MAX_STATIONS;
constexpr uint8_t CHANNEL = 1;
constexpr uint32_t RESTART_MS = 5000;
inline IPAddress address() { return IPAddress(192, 168, 4, 1); }
inline bool csvArgumentValid(const char *value) {
  if (!value) return false;
  for (const unsigned char *p = (const unsigned char *)value; *p; ++p)
    if (*p == ',' || *p < 32 || *p == 127) return false;
  return true;
}
inline bool credentialsValid(const char *ssid = SSID, const char *password = PASSWORD) {
  if (!ssid || !password) return false;
  const size_t ssidLength = strlen(ssid), passwordLength = strlen(password);
  return ssidLength >= 1 && ssidLength <= 32 && passwordLength >= 8 && passwordLength <= 63 &&
         csvArgumentValid(ssid) && csvArgumentValid(password);
}
}
