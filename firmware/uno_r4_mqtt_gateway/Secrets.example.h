#pragma once
// MQTT authentication/port only. Wi-Fi AP settings and broker IP now live in
// AccessPointConfig.h / ignored AccessPointSecrets.h in BOTH sketch folders.
// Old SOLAR_WIFI_* and SOLAR_MQTT_HOST definitions in Secrets.h are unused.
#define SOLAR_MQTT_PORT 1883
#define SOLAR_MQTT_USER ""
#define SOLAR_MQTT_PASSWORD ""
// Isolated UNO AP network. This sketch uses plain MQTT/TCP.
