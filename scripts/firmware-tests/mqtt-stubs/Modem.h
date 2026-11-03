#pragma once
#include "WiFiS3.h"
#define MAX_BUFF_SIZE 128
#define _MODE "+WIFIMODE"
#define _BEGINSOFTAP "+BEGINSOFTAP"
#define PROMPT(command) command ":"
#define CMD_WRITE(command) "AT" command "="
struct MockModem {
  void noDebug() { Mock::modemDebugDisabled = true; }
  void begin() { ++Mock::modemBegins; }
  template <typename... Args>
  bool write(const char *, String &response, const char *format, Args... args) {
    char buffer[256];
    const int length = snprintf(buffer, sizeof(buffer), format, args...);
    if (length < 0 || length >= int(sizeof(buffer))) return false;
    const std::string command(buffer, size_t(length));
    Mock::modemCommands.push_back(command);
    if (command.find("AT+WIFIMODE=") == 0) {
      ++Mock::modeWrites; response = Mock::modeWriteResult ? "1" : "0";
      return Mock::modeWriteResult;
    }
    if (command.find("AT+BEGINSOFTAP=") == 0) {
      ++Mock::apStarts;
      const size_t first = command.find('=') + 1;
      std::vector<std::string> fields;
      size_t start = first;
      while (start < command.size()) {
        const size_t end = command.find(',', start);
        fields.push_back(command.substr(start, end == std::string::npos ? end : end - start));
        if (end == std::string::npos) break;
        start = end + 1;
      }
      if (fields.size() >= 5) {
        Mock::lastApSsid = fields[0];
        Mock::apChannel = unsigned(std::stoi(fields[2]));
        Mock::apHidden = unsigned(std::stoi(fields[3]));
        Mock::apStations = unsigned(std::stoi(fields[4]));
      }
      response = Mock::apResult == WL_AP_FAILED ? "0" : Mock::softApResponse;
      if (Mock::softApWriteResult && response == "1") Mock::wifiStatus = Mock::apResult;
      return Mock::softApWriteResult;
    }
    response = "0"; return false;
  }
};
static MockModem modem;
