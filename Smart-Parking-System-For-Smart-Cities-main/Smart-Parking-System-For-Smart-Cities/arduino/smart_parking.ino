/*
  Smart Parking System - One Slot
  Hardware: NodeMCU ESP8266 + HC-SR04 Ultrasonic Sensor

  Connections:
  HC-SR04 TRIG -> D5
  HC-SR04 ECHO -> D6
  HC-SR04 VCC  -> VIN
  HC-SR04 GND  -> GND

  Required Arduino libraries:
  - ESP8266WiFi
  - Firebase Arduino Client Library for ESP8266 and ESP32 by Mobizt
*/

#include <ESP8266WiFi.h>
#include <Firebase_ESP_Client.h>

// WiFi credentials.
#define WIFI_SSID "DEVIL"
#define WIFI_PASSWORD "deepu123"

// Firebase project details.
// These values must point to the same Firebase project used by firebase-config.js.
#define API_KEY "AIzaSyCoD5W95FFD_6mepYfWms9tv_Nay209-Uo"
#define DATABASE_URL "https://smart-park-db-94758-default-rtdb.asia-southeast1.firebasedatabase.app/"

#define TRIG_PIN D5
#define ECHO_PIN D6

// Tune this value after testing in your parking slot.
// If measured distance is below this number, the slot is treated as occupied.
const int OCCUPIED_DISTANCE_CM = 15;

// Prevent noisy sensor readings from spamming Firebase.
const unsigned long READ_INTERVAL_MS = 2000;
const unsigned long WIFI_RETRY_DELAY_MS = 500;

FirebaseData firebaseData;
FirebaseConfig firebaseConfig;
FirebaseAuth firebaseAuth;

String lastPhysicalStatus = "";
unsigned long lastReadTime = 0;

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  connectWiFi();

  firebaseConfig.api_key = API_KEY;
  firebaseConfig.database_url = DATABASE_URL;

  // Anonymous sign-in is used so the ESP8266 can write to Realtime Database.
  // Enable it in Firebase Console -> Authentication -> Sign-in method -> Anonymous.
  if (Firebase.signUp(&firebaseConfig, &firebaseAuth, "", "")) {
    Serial.println("Firebase anonymous sign-in successful");
  } else {
    Serial.print("Firebase sign-in failed: ");
    Serial.println(firebaseConfig.signer.signupError.message.c_str());
  }

  Firebase.begin(&firebaseConfig, &firebaseAuth);
  Firebase.reconnectWiFi(true);

  Serial.println();
  Serial.println("Smart Parking sensor started");
}

void loop() {
  reconnectWiFiIfNeeded();

  if (millis() - lastReadTime < READ_INTERVAL_MS) {
    return;
  }

  lastReadTime = millis();

  float distance = readDistanceCm();
  String physicalStatus = distance > 0 && distance <= OCCUPIED_DISTANCE_CM ? "occupied" : "free";

  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.print(" cm | Physical status: ");
  Serial.println(physicalStatus);

  updateFirebaseStatus(physicalStatus, distance);
}

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(WIFI_RETRY_DELAY_MS);
  }

  Serial.println();
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

void reconnectWiFiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("WiFi disconnected. Reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(WIFI_RETRY_DELAY_MS);
  }

  Serial.println();
  Serial.println("WiFi reconnected");
}

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    Serial.println("Sensor timeout. Check HC-SR04 wiring.");
    return -1;
  }

  return duration * 0.0343 / 2.0;
}

void updateFirebaseStatus(String physicalStatus, float distance) {
  String currentStatus = "free";
  Firebase.RTDB.getString(&firebaseData, "/parkingSlot/status");

  if (firebaseData.dataType() == "string") {
    currentStatus = firebaseData.stringData();
  }

  // A booked slot stays booked until a car is actually detected.
  // Once the car enters, the status becomes occupied.
  // When the car leaves, the slot becomes free and booking details are cleared.
  if (physicalStatus == "occupied") {
    if (lastPhysicalStatus != "occupied" || currentStatus != "occupied") {
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/status", "occupied");
      Serial.println("Firebase updated: occupied");
    }
  } else {
    if (currentStatus == "occupied") {
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/status", "free");
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/bookedBy", "");
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/vehicleNumber", "");
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/startTime", "");
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/endTime", "");
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/price", "");
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/bookingId", "");
      Serial.println("Firebase updated: free and booking cleared");
    } else if (currentStatus != "booked" && lastPhysicalStatus != "free") {
      Firebase.RTDB.setString(&firebaseData, "/parkingSlot/status", "free");
      Serial.println("Firebase updated: free");
    }
  }

  Firebase.RTDB.setFloat(&firebaseData, "/parkingSlot/lastDistanceCm", distance);
  Firebase.RTDB.setInt(&firebaseData, "/parkingSlot/lastUpdated", millis());
  lastPhysicalStatus = physicalStatus;
}
