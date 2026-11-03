#pragma once
// Copy Secrets.example.h to Secrets.h in EACH sketch folder. Never commit Secrets.h.
#if !defined(SOLAR_USE_EXAMPLE_SETTINGS) && __has_include("Secrets.h")
#include "Secrets.h"
#else
#include "Secrets.example.h"
#endif
namespace MC {
constexpr char ROOT[] = "hexagon/v1";
constexpr char GATEWAY[] = "uno-r4";
constexpr unsigned MAX_FRAME = 1024;
constexpr unsigned RETRY_MS = 5000;
constexpr unsigned NODE_TIMEOUT_MS = 15000;
constexpr unsigned COMMAND_TIMEOUT_MS = 1500;
constexpr unsigned MAX_NODES = 8;
}
