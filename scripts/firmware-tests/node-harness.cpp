// Behavioral tests include the actual sketch; only hardware/SDK APIs are mocked.
#include <cassert>
#include <iostream>
#include "esp32_solar_node.ino"

static const uint8_t TEST_GATEWAY[6] = {2,3,4,5,6,7};
template<typename Packet> RxFrame rx(const Packet &packet, const uint8_t *mac=TEST_GATEWAY) {
  RxFrame frame = {};
  memcpy(frame.mac, mac, 6);
  memcpy(frame.data, &packet, sizeof(packet));
  frame.length = sizeof(packet);
  return frame;
}

void resetNode() {
  mockMillis=0; mockRandom=100; mockWifiOk=true;
  mockEspInitResult=mockSendResult=ESP_OK; mockSent.clear();
  std::fill(mockPinLevels, mockPinLevels+64, HIGH);
  std::fill(mockPinModes, mockPinModes+64, -1);
  std::fill(mockPinWrites, mockPinWrites+64, 0);
  mockPinLevels[D6]=LOW; mockPinLevels[D8]=LOW;
  rxHead=rxTail=rxCount=ackHead=ackTail=ackCount=0;
  txBusy=txCompleted=ready=gatewayBound=haveCommand=false;
  enabled=NodeConfig::POWER_RELAY_PIN < 0;
  telemetryDirty=telemetryRequested=telemetryOutstanding=false;
  nodeId=NodeConfig::MANUAL_NODE_ID; configBits=MANUAL_CONFIG; hallMask=0;
  memset(gatewayMac,0,6); telemetryAttempts=0;
  bootId=gatewayBootId=nextSequence=lastTelemetryAt=nextPeriodicAt=retryAt=nextRadioAt=0;
  lastUptimeTick=0; elapsedUptimeMs=0; coordQ=coordR=0;
  currentTelemetry={}; lastCommand={}; lastCommandAck={};
}

void setupNode() { resetNode(); setup(); assert(ready); }

void bindGateway(uint32_t gatewayBoot=77) {
  beginTelemetry(1000);
  telemetryAttempts=1;
  Receipt receipt={header(RECEIPT),nodeId,bootId,currentTelemetry.sequence,gatewayBoot};
  acceptReceipt(rx(receipt));
  assert(gatewayBound && gatewayBootId==gatewayBoot && !telemetryOutstanding);
}

Control command(uint32_t sequence, uint8_t kind=SET_POWER, uint8_t param=1) {
  return {header(CONTROL),nodeId,kind,param,bootId,gatewayBootId,sequence};
}

void testSetupAndId() {
  setupNode(); assert(bootId != 0);
  for (uint8_t pin : NodeConfig::HALL_PINS) assert(mockPinModes[pin]==INPUT_PULLUP);
  if (NodeConfig::USE_HARDWARE_ID) {
    assert(nodeId==6 && configBits==5);
    for (uint8_t pin : NodeConfig::HARDWARE_ID_PINS) assert(mockPinModes[pin]==INPUT_PULLUP);
    mockPinLevels[D6]=mockPinLevels[D8]=HIGH;
    pollHallInputs(2000); assert(nodeId==6 && configBits==5);
  } else {
    assert(nodeId==1 && configBits==MANUAL_CONFIG);
    for (uint8_t pin : NodeConfig::HARDWARE_ID_PINS) assert(mockPinModes[pin]==-1);
  }
  if (NodeConfig::POWER_RELAY_PIN >= 0)
    assert(!enabled && mockPinLevels[NodeConfig::POWER_RELAY_PIN]==LOW);
  else assert(enabled);
  resetNode(); mockWifiOk=false; setup(); assert(!ready);
  loop(); assert(mockSent.empty());
  resetNode(); mockEspInitResult=-1; setup(); assert(!ready);
  loop(); assert(mockSent.empty());
}

void testDebounceAndRollover() {
  setupNode();
  mockPinLevels[D0]=LOW; pollHallInputs(100); pollHallInputs(124); assert(hallMask==0);
  mockPinLevels[D0]=HIGH; pollHallInputs(125);
  mockPinLevels[D0]=LOW; pollHallInputs(130); pollHallInputs(154); assert(hallMask==0);
  pollHallInputs(155); assert(hallMask==1 && telemetryDirty);
  mockPinLevels[D1]=LOW; pollHallInputs(0xfffffff0U); pollHallInputs(9); assert(hallMask==3);
  mockPinLevels[D0]=HIGH; pollHallInputs(20); pollHallInputs(45); assert(hallMask==2);
}

void testReceiptValidationAndQueue() {
  setupNode(); beginTelemetry(1000); telemetryAttempts=1;
  Receipt receipt={header(RECEIPT),nodeId,bootId,currentTelemetry.sequence+1,77};
  acceptReceipt(rx(receipt)); assert(!gatewayBound);
  receipt.telemetrySequence=currentTelemetry.sequence;
  receipt.nodeBootId=bootId+1; acceptReceipt(rx(receipt)); assert(!gatewayBound);
  receipt.nodeBootId=bootId;
  RxFrame frame=rx(receipt); --frame.length; acceptReceipt(frame); assert(!gatewayBound);
  uint8_t multicast[6]={1,2,3,4,5,6}; acceptReceipt(rx(receipt,multicast)); assert(!gatewayBound);
  acceptReceipt(rx(receipt)); assert(gatewayBound);
  for (int i=0; i<10; ++i) enqueueRx(TEST_GATEWAY,reinterpret_cast<uint8_t*>(&receipt),sizeof(receipt));
  assert(rxCount==RX_CAPACITY); processReceived(); assert(rxCount==0);
}

void testControlDedupeAndSessions() {
  setupNode(); bindGateway();
  Control ctrl=command(1), invalid=ctrl; ++invalid.nodeBootId;
  acceptControl(rx(invalid)); assert(ackCount==0);
  uint8_t stranger[6]={2,3,4,5,6,8}; acceptControl(rx(ctrl,stranger)); assert(ackCount==0);
  acceptControl(rx(ctrl)); assert(ackCount==1 && haveCommand);
  const uint8_t expected=NodeConfig::POWER_RELAY_PIN >= 0 ? APPLIED : UNSUPPORTED;
  assert(lastCommandAck.result==expected);
  const int writes=NodeConfig::POWER_RELAY_PIN >= 0 ? mockPinWrites[NodeConfig::POWER_RELAY_PIN] : 0;
  acceptControl(rx(ctrl)); assert(ackCount==2 && ackQueue[1].packet.result==expected);
  if (NodeConfig::POWER_RELAY_PIN >= 0) assert(mockPinWrites[NodeConfig::POWER_RELAY_PIN]==writes);
  invalid=ctrl; invalid.param=0; acceptControl(rx(invalid)); assert(ackQueue[2].packet.result==BAD_COMMAND);
  invalid=command(0); acceptControl(rx(invalid)); assert(ackQueue[3].packet.result==STALE_COMMAND);
  assert(lastCommand.sequence==1);
  loseGateway(3000); assert(!gatewayBound && haveCommand);
  bindGateway(); assert(haveCommand);
  acceptControl(rx(ctrl));
  if (NodeConfig::POWER_RELAY_PIN >= 0) assert(mockPinWrites[NodeConfig::POWER_RELAY_PIN]==writes);
  bindGateway(78); assert(!haveCommand);
  acceptControl(rx(ctrl)); assert(ackCount==0);
  ctrl=command(1,REQUEST_TELEMETRY,0); acceptControl(rx(ctrl));
  assert(lastCommandAck.result==APPLIED && telemetryRequested);
  invalid=command(2,SET_POWER,2); acceptControl(rx(invalid)); assert(lastCommandAck.result==BAD_COMMAND);
}

void testSingleTransmissionAndTimeout() {
  setupNode(); beginTelemetry(1000); serviceRadio(1000);
  assert(mockSent.size()==1 && txBusy && telemetryAttempts==1);
  serviceRadio(2000); assert(mockSent.size()==1);
  onSent(nullptr,ESP_NOW_SEND_FAIL); serviceRadio(2000); assert(mockSent.size()==1);
  serviceRadio(2005); assert(mockSent.size()==2);
  onSent(nullptr,ESP_NOW_SEND_SUCCESS); serviceRadio(3000); serviceRadio(3005);
  onSent(nullptr,ESP_NOW_SEND_SUCCESS); serviceRadio(4000); serviceRadio(4005);
  assert(mockSent.size()==4);
  onSent(nullptr,ESP_NOW_SEND_SUCCESS); serviceRadio(5000); serviceRadio(5005);
  assert(!telemetryOutstanding && !gatewayBound && mockSent.size()==4);
  bindGateway(); const auto ctrl=command(1,REQUEST_TELEMETRY,0);
  acceptControl(rx(ctrl)); beginTelemetry(6000); serviceRadio(6000);
  assert(mockSent.back().data[3]==CONTROL_ACK);
}

int main() {
  testSetupAndId(); testDebounceAndRollover(); testReceiptValidationAndQueue();
  testControlDedupeAndSessions(); testSingleTransmissionAndTimeout();
  std::cout << "PASS: node setup, ID pins, debounce/rollover, binding, commands, deduplication, retries, TX arbitration\n";
}
