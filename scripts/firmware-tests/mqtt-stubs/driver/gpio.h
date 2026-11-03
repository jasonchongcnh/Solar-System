#pragma once
inline bool mockValidGpio(int pin) { return pin >= 0 && pin < 40; }
#define GPIO_IS_VALID_GPIO(pin) mockValidGpio(pin)
#define GPIO_IS_VALID_OUTPUT_GPIO(pin) mockValidGpio(pin)
