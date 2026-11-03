#pragma once
#include <Modem.h>
#include "AccessPointConfig.h"

// WiFiS3 beginAP() omits the bridge's fifth argument and defaults to five
// stations. Use its public modem interface to request the full system capacity.
// Stock bridge 0.6.0 supports this command; do not fall back on rejection.
inline bool startUnoAccessPoint(const char *ssid, const char *password,
                                unsigned channel, unsigned stations) {
  if (!APConfig::credentialsValid(ssid, password) || channel < 1 || channel > 14 ||
      stations < 2 || stations > 10) return false;
  char command[MAX_BUFF_SIZE];
  const int length = snprintf(command, sizeof(command), "%s%s,%s,%u,0,%u\r\n",
                             CMD_WRITE(_BEGINSOFTAP), ssid, password, channel, stations);
  if (length < 0 || size_t(length) >= sizeof(command)) return false;
  modem.noDebug(); // Modem debug output otherwise includes the AP password.
  modem.begin();
  std::string response;
  if (!modem.write(PROMPT(_MODE), response, "%s%d\r\n", CMD_WRITE(_MODE), 2)) return false;
  return modem.write(PROMPT(_BEGINSOFTAP), response, "%s", command) && response == "1";
}
