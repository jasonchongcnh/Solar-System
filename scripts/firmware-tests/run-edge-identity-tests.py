"""Exercise edge frame/handshake and SC16IS752 register behavior without boards."""
import argparse
import pathlib
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--compiler", default=shutil.which("g++") or "g++")
args = parser.parse_args()
here = pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="hexagon-edge-identity-tests-") as temporary:
    executable = pathlib.Path(temporary) / "edge-tests"
    subprocess.run([
        args.compiler, "-std=c++14", "-Wall", "-Wextra", "-pedantic",
        "-I" + str(here / "mqtt-stubs"),
        "-I" + str(here.parent.parent / "firmware" / "esp32_mqtt_solar_node"),
        str(here / "edge-identity-harness.cpp"), "-o", str(executable),
    ], check=True)
    subprocess.run([str(executable)], check=True)
