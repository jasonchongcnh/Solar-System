"""Run actual node sketch with mocked GPIO/radio, using a C++14 compiler.

python scripts/firmware-tests/run-node-tests.py [--compiler /path/to/g++]
All generated files are isolated in a temporary folder. No board is flashed.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", default=os.environ.get("CXX") or shutil.which("g++"))
    args = parser.parse_args()
    compiler = args.compiler
    if not compiler and os.name == "nt":
        candidate = Path(r"C:\Program Files (x86)\Dev-Cpp\MinGW64\bin\g++.exe")
        if candidate.is_file():
            compiler = str(candidate)
    if not compiler:
        parser.error("No C++ compiler found; pass --compiler with the path to g++.")
    here = Path(__file__).resolve().parent
    sketch = here.parents[1] / "firmware" / "esp32_solar_node"
    env = dict(os.environ)
    env["PATH"] = str(Path(compiler).resolve().parent) + os.pathsep + env.get("PATH", "")
    with tempfile.TemporaryDirectory(prefix="solar-node-tests-") as work:
        temp = Path(work)
        stub_dir = temp / "stubs"
        stub_dir.mkdir()
        shutil.copy(here / "node-stubs" / "mock_platform.h", stub_dir)
        for name in ("Arduino.h", "WiFi.h", "esp_now.h", "esp_wifi.h", "esp_system.h", "esp_idf_version.h", "driver/gpio.h"):
            wrapper = stub_dir / name
            wrapper.parent.mkdir(exist_ok=True)
            wrapper.write_text('#include "mock_platform.h"\n', encoding="utf-8")
        for mode in ("manual-no-relay", "hardware-id-with-relay"):
            source = temp / mode
            source.mkdir()
            for name in ("esp32_solar_node.ino", "SolarProtocol.h", "NodeConfig.h"):
                shutil.copy(sketch / name, source)
            if mode == "hardware-id-with-relay":
                config = source / "NodeConfig.h"
                text = config.read_text(encoding="utf-8")
                assert "USE_HARDWARE_ID = false" in text and "POWER_RELAY_PIN = -1" in text
                text = text.replace("USE_HARDWARE_ID = false", "USE_HARDWARE_ID = true")
                text = text.replace("POWER_RELAY_PIN = -1", "POWER_RELAY_PIN = 10")
                config.write_text(text, encoding="utf-8")
            executable = source / ("node-test.exe" if os.name == "nt" else "node-test")
            # MinGW defaults to the MS struct ABI; ESP32 uses GCC packed layouts.
            abi_flags = ["-mno-ms-bitfields"] if os.name == "nt" else []
            subprocess.run([compiler, "-std=c++14", "-Wall", "-Wextra", "-Werror",
                            "-Wno-missing-field-initializers", "-Wno-type-limits", *abi_flags, "-I", str(stub_dir),
                            "-I", str(source), str(here / "node-harness.cpp"), "-o", str(executable)], check=True, env=env)
            print(mode + ":", flush=True)
            subprocess.run([str(executable)], check=True, env=env)


if __name__ == "__main__":
    main()
