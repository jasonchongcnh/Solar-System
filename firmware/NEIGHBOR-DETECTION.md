# Automatic identification of attached modules

This extension adds a separate identity channel at each edge of the XIAO ESP32-C3
MQTT nodes. A Hall switch still reports magnetic presence. The new edge channel
exchanges the module ID, edge number, boot identity and MAC address with the
module attached to that particular edge. MQTT carries these observations through
the existing broker and UNO R4 gateway to the console.

**Additional hardware is required on every module that participates.** The
feature ships disabled, so uploading the default sketch retains Hall-only
operation. Installing this software alone does not give fixed magnets an ID.

## Hardware per module

- Three **SC16IS752 dual-UART** bridges, operated at 3.3 V in I2C mode. Each
  bridge provides two independent UART channels, giving six edge ports.
- One three-contact connection per edge: **TX, RX and GND**. Mating contacts must
  cross TX to the other module's RX, RX to its TX, and ground to ground.
- Local power, decoupling, reset pull-ups, I2C pull-ups and the clock components
  required by the selected bridge boards. Configure the firmware's clock value
  to match the fitted oscillator; its default is **14.7456 MHz**.

Use 3.3 V UART logic, not an RS-232 voltage interface. Keep each edge's signals
separate: tying multiple edge UARTs together removes the physical identity of the
port. The bridge chips are local to each module; I2C does not cross the edges.
The three edge contacts do not join modules' positive power rails.

The [NXP SC16IS752/762 datasheet](https://www.nxp.com/docs/en/data-sheet/SC16IS752_SC16IS762.pdf)
documents the dual UART, FIFO, clock and register interface. The
[Seeed XIAO ESP32-C3 pin guide](https://wiki.seeedstudio.com/XIAO_ESP32C3_Pin_Multiplexing/)
documents the board labels. D9 is GPIO9 and also the BOOT pin: the added I2C
hardware must release it HIGH at reset. D4/D5 remain Hall inputs in this project;
the firmware explicitly moves I2C to D9/D10.

### XIAO wiring

| XIAO connection | Function |
| --- | --- |
| D0–D5 | Existing Hall inputs for sides 0–5 |
| D9 / GPIO9 | SDA for all three local UART bridges |
| D10 / GPIO10 | SCL for all three local UART bridges |
| 3V3 | Local bridge supply and pull-up reference |
| GND | Local bridges and each edge's ground contact |
| D6–D8 | Existing optional hardware-ID straps; unchanged |

Select I2C mode on each bridge and use different addresses. These are **7-bit
Wire addresses**, not the 8-bit read/write address bytes printed in NXP's table.

| Bridge | A1 strap | A0 strap | Address | Channel A | Channel B |
| --- | --- | --- | --- | --- | --- |
| 0 | VDD | VDD | `0x48` | Side 0 / Hall D0 | Side 1 / Hall D1 |
| 1 | VDD | GND | `0x49` | Side 2 / Hall D2 | Side 3 / Hall D3 |
| 2 | GND | VDD | `0x4C` | Side 4 / Hall D4 | Side 5 / Hall D5 |

Bridge address, SDA/SCL pins and oscillator frequency are configurable in
`esp32_mqtt_solar_node/NodeConfig.h`. Board jumpers can use different labels;
check their schematics against these A1/A0 straps. RESET must be deasserted and
the oscillator must be running. IRQ, RTS and CTS are not needed by this polling
driver. Supply the chips from a suitable local regulator if their total load
exceeds the available 3.3 V budget.

For example, connecting module 1 side 2 to module 4 side 5 requires:

```text
Module 1: bridge 1, channel A       Module 4: bridge 2, channel B
                   TX ----------> RX
                   RX <---------- TX
                  GND ----------- GND
                 Hall D2         Hall D5
```

Side numbering is tied to the wired Hall input and UART channel. Number the
physical edges consistently on each module. The software does not assume that
the other side is `(side + 3) % 6`; rotated modules report their own edge number.

## Enable and upload

1. Fit the bridges and edge contacts on two modules first. Confirm the addresses,
   oscillator frequency, signal crossing and Hall-to-port correspondence.
2. In each node's `NodeConfig.h`, set `SOLAR_EDGE_IDENTITY_ENABLED` to `1` and
   assign its existing unique `MANUAL_NODE_ID` (1–8). Keep **USB CDC On Boot**
   enabled for the XIAO ESP32-C3.
3. Upload the updated `esp32_mqtt_solar_node` sketch to both XIAOs and the updated
   `uno_r4_mqtt_gateway` sketch to the UNO. Keep the new node headers beside its
   `.ino`. No replacement UNO connectivity-module firmware is needed.
4. Start the existing MQTT broker, then connect the console by UNO USB or the
   MQTT-to-WebSocket bridge as described in [MQTT.md](MQTT.md).
5. Attach the two edges. In **Device Management → HEX-xx**, inspect the live
   neighbor section. A confirmed pair identifies both module IDs and both sides.
   The details update while the window remains open.

The sketches require only their existing Arduino dependencies plus the board
package's built-in `Wire` library; the bridge driver is included in the node
folder. Enable the feature on every node that should identify its neighbors.
Old Hall-only nodes remain readable, but cannot supply a neighbor identity.

## What the program confirms

Each occupied edge sends an identity frame periodically. A new connection uses a
fresh random challenge. A peer must echo that challenge across the same UART
port before its identity is reported. The frame includes a sequence and CRC;
the receiver rejects malformed frames, its own identity and stale exchanges.
The node drops its peer when the Hall input clears, the peer expires, or the
hardware stops responding. Buffered UART bytes are discarded after a service
gap so old data cannot be treated as a newly received identity.

The console marks a connection **Confirmed** only when fresh reports from both
modules agree on the two endpoints, both Hall inputs are active, and the peer
MAC/boot identities match the current reports. A one-sided observation waits for
peer confirmation. A hardware fault, conflicting report, offline node, expired
identity or disconnected gateway removes confirmation. Replacing a module
requires a fresh exchange rather than reusing an old configured ID.

CRC detects damaged frames; it is not cryptographic authentication. The direct
edge wiring establishes which physical port supplied the identity. It does not
certify the module's structural strength, waterproofing or electrical power path.
The displayed q/r coordinates remain configured positions, not measured geometry.

## MQTT data

Node telemetry adds `neighbor_detection` (`disabled`, `ready` or `hardware_error`)
and `edge_neighbors`, an array of exactly six entries in D0–D5 order. Each entry
is `null` or a locally confirmed peer:

```json
{
  "neighbor_detection": "ready",
  "edge_neighbors": [
    null,
    null,
    {"id":4,"side":5,"boot_id":1234,"mac":"02:00:00:00:00:04","age_ms":50},
    null,
    null,
    null
  ]
}
```

This is an excerpt of node 1's telemetry, not a standalone telemetry packet.
It says node 1 side 2 has received node 4 side 5's identity. The console also
checks node 4's reciprocal report before drawing a confirmed link.

The UART exchange runs at 9600 baud, 8 data bits, no parity and one stop bit.
The default transmit period is 750 ms and the identity timeout is 3000 ms.
MQTT publishes changes and its existing one-second periodic sample. Network and
hardware timing still need measurement on the actual assembly.

## Bench checks

Test every side, rotate a module, attach several pairs simultaneously, swap
modules, remove only a data contact, remove a magnet, reboot either endpoint,
disconnect a bridge and stop MQTT. Confirm that the correct IDs reappear only
after fresh exchanges and that old links lose confirmation. Test two modules
with the same configured ID and correct the IDs before expanding the array.

Software tests and compilation do not validate the new physical connectors,
oscillators, I2C bus, UART voltage levels or operation on water. See
[NEIGHBOR-VALIDATION.md](NEIGHBOR-VALIDATION.md) for checks performed on this
implementation.
