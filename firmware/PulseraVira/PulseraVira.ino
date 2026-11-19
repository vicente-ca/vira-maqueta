#include <Arduino.h>
#include <NimBLEDevice.h>
#include <atomic>

// Configurar el lado antes de cargar cada placa (L izquierda, R derecha).
#ifndef VIRA_SIDE
#define VIRA_SIDE 'L'
#endif
constexpr char side = VIRA_SIDE;
static_assert(side == 'L' || side == 'R', "El lado debe ser L o R");
constexpr uint8_t motorPin = 4;  // Entrada de control del módulo con MOSFET.
constexpr char serviceId[] = "42aa0001-7331-4d61-b432-9b418a6297d1";
constexpr char commandId[] = "42aa0002-7331-4d61-b432-9b418a6297d1";

std::atomic<char> pending{0};
bool pulsing = false;
uint32_t started = 0;

class Commands : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* ch, NimBLEConnInfo&) override {
    const auto data = ch->getValue();
    if (data.size() == 1 && (data[0] == side || data[0] == 'P')) pending.store(data[0]);
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
  const char* name = side == 'L' ? "Vira-L" : "Vira-R";
  NimBLEDevice::init(name);
  auto server = NimBLEDevice::createServer();
  server->setCallbacks(&connection);
  auto service = server->createService(serviceId);
  auto command = service->createCharacteristic(commandId, NIMBLE_PROPERTY::WRITE);
  command->setCallbacks(&commands);
  service->start();
  auto advertising = NimBLEDevice::getAdvertising();
  advertising->enableScanResponse(true);
  advertising->setName(name);
  advertising->addServiceUUID(serviceId);
  advertising->start();
}

void loop() {
  const char command = pending.exchange(0);
  if (command == side) {
    started = millis();
    pulsing = true;
  } else if (command == 'P') {
    pulsing = false;
  }
  const uint32_t elapsed = millis() - started;
  if (elapsed >= 1900) pulsing = false;
  digitalWrite(motorPin, pulsing && elapsed % 700 < 500 ? HIGH : LOW);
  delay(5);
}
