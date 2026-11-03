"""Exercise the actual ESP32 MQTT node with mocked IO and real ArduinoJson.

Private Secrets.h / AccessPointSecrets.h are never read or copied. Legacy router
macros are deliberately poisoned to prove the AP configuration is used instead.
"""
import argparse
import os
import pathlib
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--arduinojson", required=True, type=pathlib.Path)
parser.add_argument("--compiler", default=shutil.which("g++") or "g++")
args = parser.parse_args()
here = pathlib.Path(__file__).resolve().parent
sketch = here.parent.parent / "firmware" / "esp32_mqtt_solar_node"
if not (args.arduinojson / "ArduinoJson.h").is_file():
    parser.error("--arduinojson must point to ArduinoJson's src directory")
with tempfile.TemporaryDirectory(prefix="hexagon-mqtt-node-tests-") as temporary:
    output = pathlib.Path(temporary)
    for source in sketch.iterdir():
        if source.is_file() and source.suffix in (".h", ".ino") and source.name not in ("Secrets.h", "AccessPointSecrets.h"):
            shutil.copy2(source, output / source.name)
    # A test-only stand-in for legacy credentials; never inspect the user's file.
    (output / "Secrets.example.h").write_text(
        '#pragma once\n#ifndef SOLAR_WIFI_SSID\n#define SOLAR_WIFI_SSID "legacy-router"\n#endif\n'
        '#ifndef SOLAR_WIFI_PASSWORD\n#define SOLAR_WIFI_PASSWORD "legacy-password"\n#endif\n'
        '#ifndef SOLAR_MQTT_HOST\n#define SOLAR_MQTT_HOST "203.0.113.99"\n#endif\n'
        '#define SOLAR_MQTT_PORT 1883\n#define SOLAR_MQTT_USER ""\n#define SOLAR_MQTT_PASSWORD ""\n',
        encoding="utf8",
    )
    executable = output / "mqtt-node-tests.exe"
    subprocess.run([
        # The disabled relay sentinel (-1) makes uint8_t pin == relay a constant
        # false comparison in this default configuration on older desktop GCC.
        args.compiler, "-std=c++14", "-Wall", "-Wextra", "-pedantic", "-Wno-type-limits",
        "-I" + str(here / "mqtt-stubs"), "-I" + str(args.arduinojson),
        "-DSOLAR_USE_EXAMPLE_SETTINGS=1", "-DARDUINO_USB_CDC_ON_BOOT=1", "-DCONFIG_IDF_TARGET_ESP32C3=1",
        '-DSOLAR_WIFI_SSID="legacy-router"', '-DSOLAR_WIFI_PASSWORD="legacy-password"',
        '-DSOLAR_MQTT_HOST="203.0.113.99"',
        '-DSOLAR_NODE_SKETCH="' + (output / "esp32_mqtt_solar_node.ino").as_posix() + '"',
        str(here / "mqtt-node-harness.cpp"), "-o", str(executable),
    ], check=True)
    environment = os.environ.copy()
    compiler_path = pathlib.Path(args.compiler).resolve()
    if compiler_path.is_file():
        environment["PATH"] = str(compiler_path.parent) + os.pathsep + environment.get("PATH", "")
    subprocess.run([str(executable)], check=True, env=environment)
