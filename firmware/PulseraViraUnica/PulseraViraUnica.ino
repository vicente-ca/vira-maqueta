// Configuración de una sola pulsera: 1 vibración = izquierda, 2 = derecha.
// Complementa a PulseraVira (una pulsera por muñeca), que sigue igual.
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <atomic>

// Con otro nombre, la página no la confunde con Vira-L o Vira-R.
constexpr char deviceName[] = "Vira-1";
constexpr uint8_t motorPin = 4;
// Pulsos largos para que se sientan con ropa gruesa.
constexpr uint32_t pulseOn = 700;
constexpr uint32_t pulseOff = 400;
constexpr char serviceId[] = "42aa0001-7331-4d61-b432-9b418a6297d1";
constexpr char commandId[] = "42aa0002-7331-4d61-b432-9b418a6297d1";

std::atomic<char> pending{0};
uint32_t pulses = 0;
uint32_t started = 0;

class Commands : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* ch, NimBLEConnInfo&) override {
    const auto data = ch->getValue();
    if (data.size() == 1 && (data[0] == 'L' || data[0] == 'R' || data[0] == 'P')) pending.store(data[0]);
  }
} commands;

class Connection : public NimBLEServerCallbacks {
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    pending.store('P');
    NimBLEDevice::startAdvertising();
  }
} connection;

void setup() {
  pinMode(motorPin, OUTPUT);
  digitalWrite(motorPin, LOW);
  NimBLEDevice::init(deviceName);
  auto server = NimBLEDevice::createServer();
  server->setCallbacks(&connection);
  auto service = server->createService(serviceId);
  auto command = service->createCharacteristic(commandId, NIMBLE_PROPERTY::WRITE);
  command->setCallbacks(&commands);
  service->start();
  auto advertising = NimBLEDevice::getAdvertising();
  advertising->enableScanResponse(true);
  advertising->setName(deviceName);
  advertising->addServiceUUID(serviceId);
  advertising->start();
}

void loop() {
  const char command = pending.exchange(0);
  if (command) {
    pulses = command == 'L' ? 1 : command == 'R' ? 2 : 0;
    started = millis();
  }
  const uint32_t elapsed = millis() - started;
  if (elapsed >= pulses * (pulseOn + pulseOff)) pulses = 0;
  digitalWrite(motorPin, pulses && elapsed % (pulseOn + pulseOff) < pulseOn ? HIGH : LOW);
  delay(5);
}
