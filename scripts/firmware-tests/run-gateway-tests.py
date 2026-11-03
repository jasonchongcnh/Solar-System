"""Compile the actual gateway sketch with desktop IO adapters and real ArduinoJson.

Usage: python run-gateway-tests.py --arduinojson /path/to/ArduinoJson/src [--compiler g++]
No hardware is contacted. Build output goes to a temporary directory.
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
if not (args.arduinojson / "ArduinoJson.h").is_file():
    parser.error("--arduinojson must point to the library's src directory")
with tempfile.TemporaryDirectory(prefix="hexagon-gateway-tests-") as output:
    executable = pathlib.Path(output) / "gateway-tests.exe"
    # MinGW defaults to Microsoft's struct ABI; the ESP32 wire format uses GCC
    # packed structs. Match it explicitly without altering the shared protocol.
    platform_flags = ["-mno-ms-bitfields"] if os.name == "nt" else []
    subprocess.run([
        args.compiler, "-std=c++14", "-Wall", "-Wextra", "-pedantic",
        "-Wno-missing-field-initializers", *platform_flags,
        "-I" + str(here / "gateway-stubs"), "-I" + str(args.arduinojson),
        str(here / "gateway-harness.cpp"), "-o", str(executable),
    ], check=True)
    runtime_environment = os.environ.copy()
    compiler_path = pathlib.Path(args.compiler).resolve()
    if compiler_path.is_file():
        runtime_environment["PATH"] = str(compiler_path.parent) + os.pathsep + runtime_environment.get("PATH", "")
    subprocess.run([str(executable)], check=True, env=runtime_environment)
