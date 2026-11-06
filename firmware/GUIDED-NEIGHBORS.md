# Identify neighbors with the existing Hall sensors

Use **guided pairing** when the modules have their original six Hall switches,
fixed magnets and MQTT firmware. No new hardware is needed, and the optional
UART identity feature can stay disabled.

The switches show which sides detect magnets. They cannot read the other
module's identity. Guided pairing observes two newly activated edges and asks
you to confirm the module labels before saving that connection. It is an
operator-confirmed mapping, not automatic electronic identification.

## Pair two modules

1. Start the existing MQTT broker and gateway. Connect the console using the
   UNO's USB connection or the MQTT-to-WebSocket bridge. Confirm that both
   modules have fresh live telemetry and different node IDs.
2. Keep the two edges you want to pair separated, so both Hall inputs are clear.
   In **Device Management**, select **Pair neighbors**.
3. Attach **one pair of edges only**. Leave other module connections alone while
   pairing. The dialog waits for two Hall inputs on different modules to turn
   active and remain stable.
4. Check the proposed connection against the labels on the physical modules,
   for example **HEX-01 D2 ↔ HEX-04 D5**. Select **Confirm pairing** only when
   those are the two edges you just connected.
5. Open either module's device details. Its edge now shows the paired neighbor
   with an **operator-paired** label. The overview draws this connection with a
   dashed line, distinct from the optional hardware identity channel.

Both modules must keep reporting during pairing. The default stability interval
is 1.5 seconds; a session times out after one minute. If more than two edges
change, a module restarts, an input clears, or telemetry stops, the dialog asks
you to restart rather than guessing a connection.

Existing active edges are not treated as newly attached. To discover an
already assembled connection, detach that pair first, wait for both Hall states
to clear, then start pairing and attach it again. Do not break unrelated links
while a pairing session is running.

## Saved connections and reconfirmation

The console stores the two module IDs, sides and MAC addresses in this browser's
local storage. Saving does not copy the map to the UNO, MQTT broker or another
browser. Pairing requires permission to control devices.

A saved map survives reload, but its **active confirmation does not**. The
console requires reconfirmation after a detected Hall disconnection, node
restart, stale/offline data or gateway disconnect. A Hall input turning active
again cannot establish which module was reattached.

To reuse a saved connection, open **Pair neighbors**, physically check both
module labels and their attached edges, then use **Reconfirm**. Both endpoints
must have fresh live Hall readings and the same MAC addresses as the saved
mapping. If an edge is now connected to a different module, **Forget** the old
pair and create a new pairing instead.

The console uses a three-second freshness limit for pairing. Repeated or older
sequence numbers do not renew confidence. Missing or malformed Hall data and
demo/test-packet injection cannot create a pairing. If browser storage is
unavailable, the current tab can still hold a pairing, but it cannot promise to
restore the saved map later.

## Limits of the existing hardware

Two Hall changes occurring together suggest a pair; your confirmation supplies
the identity mapping. Two independent magnets, simultaneous unrelated
connections, or a rapid swap between telemetry samples cannot be distinguished
reliably by the switches. Reconfirm the affected connections whenever you move
or replace modules, even if the console did not observe an interruption.

The mapping does not prove mechanical locking, an electrical power connection,
or actual q/r coordinates. The optional edge UART system described in
[NEIGHBOR-DETECTION.md](NEIGHBOR-DETECTION.md) remains available for a future
hardware upgrade, but is not required for this workflow.

## Software verification

Run the deterministic pairing-engine checks and browser workflow test:

```sh
npm run test:pairing
```

The tests use controlled telemetry. They do not establish Hall alignment or
connectivity on the real modules. MQTT setup remains described in
[MQTT.md](MQTT.md).
