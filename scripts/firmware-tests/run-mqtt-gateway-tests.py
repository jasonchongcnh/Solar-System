"""Exercise the actual UNO R4 MQTT gateway with mocked networking and real ArduinoJson.

Private Secrets.h / AccessPointSecrets.h are never read or copied. Public files are copied
to a temporary build directory so the public example configuration is used instead.
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
sketch = here.parent.parent / "firmware" / "uno_r4_mqtt_gateway"
if not (args.arduinojson / "ArduinoJson.h").is_file():
    parser.error("--arduinojson must point to ArduinoJson's src directory")
with tempfile.TemporaryDirectory(prefix="hexagon-mqtt-gateway-tests-") as temporary:
    output = pathlib.Path(temporary)
    for source in sketch.iterdir():
        if source.is_file() and source.suffix in (".h", ".ino") and source.name not in ("Secrets.h", "AccessPointSecrets.h"):
            shutil.copy2(source, output / source.name)
    environment = os.environ.copy()
    compiler_path = pathlib.Path(args.compiler).resolve()
    if compiler_path.is_file():
        environment["PATH"] = str(compiler_path.parent) + os.pathsep + environment.get("PATH", "")
    for name, variant_flags in (
        ("configured", []),
        ("invalid-password", ['-DSOLAR_AP_PASSWORD="short"', "-DSOLAR_TEST_INVALID_AP=1"]),
        ("comma-ssid", ['-DSOLAR_AP_SSID="bad,ssid"', "-DSOLAR_TEST_INVALID_AP=1"]),
        ("control-ssid", ['-DSOLAR_AP_SSID="bad\\nssid"', "-DSOLAR_TEST_INVALID_AP=1"]),
        ("max-credentials", ['-DSOLAR_AP_SSID="' + "S" * 32 + '"', '-DSOLAR_AP_PASSWORD="' + "p" * 63 + '"', "-DSOLAR_TEST_MAX_CREDENTIALS=1"]),
        ("insufficient-stations", ["-DSOLAR_AP_MAX_STATIONS=8", "-DSOLAR_TEST_INVALID_CAPACITY=1"]),
        ("excessive-stations", ["-DSOLAR_AP_MAX_STATIONS=11", "-DSOLAR_TEST_INVALID_CAPACITY=1"]),
        ("ten-stations", ["-DSOLAR_AP_MAX_STATIONS=10", "-DSOLAR_TEST_TEN_STATIONS=1"]),
    ):
        executable = output / ("mqtt-gateway-tests-" + name + ".exe")
        subprocess.run([
            args.compiler, "-std=c++14", "-Wall", "-Wextra", "-pedantic",
            "-I" + str(here / "mqtt-stubs"), "-I" + str(args.arduinojson), "-DSOLAR_USE_EXAMPLE_SETTINGS=1",
            '-DSOLAR_GATEWAY_SKETCH="' + (output / "uno_r4_mqtt_gateway.ino").as_posix() + '"',
            *variant_flags, str(here / "mqtt-gateway-harness.cpp"), "-o", str(executable),
        ], check=True)
        subprocess.run([str(executable)], check=True, env=environment)
