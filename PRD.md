# Product Requirements Document (PRD)

## 1. Vision & Scope

**Product Name:** GeoWake

**Tagline:** Smart transit geofencing and wake-up alarms.

**One-Liner:** Drop a pin anywhere on the map, choose a radius, and GeoWake rings an alarm siren the moment you arrive. Destinations can be picked by hand, saved as favorites, or described in plain language ("wake me up 1 km before the airport") and resolved by an AI + geocoding pipeline.

**Target Platform:** Web only (Expo SDK 57, React Native Web). No iOS/Android builds in this release.

**Target Users:**
- **Daily Commuter** — train/bus riders who need reliable wake-up before their stop
- **Student** — campus shuttle users with variable schedules
- **Shift Worker** — odd-hour travelers needing custom alarm sounds and vibration

---

## 2. User Personas

| Persona | Context | Pain Points | GeoWake Value |
|---------|---------|-------------|---------------|
| **Daily Commuter** | Train/bus to work, same route daily | Falls asleep, misses stop, existing phone alarms don't know location | Drop pin once at destination, set radius, works every trip |
| **Student** | Campus shuttles, irregular schedules, multiple destinations | Different stops for different classes, hard to set individual alarms | Favorites panel saves "Library", "Dorm", "Lab" with custom radii |
| **Shift Worker** | Late/early hours, noisy environments, needs strong wake-up | Phone vibration too weak, default tones ignored | 8 synth presets (iOS/Android/Gentle) + custom MP3 + vibration patterns |

---

## 3. Core Features (Epics → User Stories)

### E1: Drop-Pin Alarm Creation
| ID | User Story | Acceptance Criteria (Gherkin) |
|----|------------|------------------------------|
| E1.1 | As a user, I can drop a pin on the map to create an alarm | ```gherkin\nGiven the map is visible\nWhen I long-press a location\nThen a pin appears\nAnd the alarm card opens with that coordinate\n``` |
| E1.2 | As a user, I can set an alarm title | ```gherkin\nGiven the alarm card is open\nWhen I type "Airport" in the title field\nThen the title is saved with the alarm\n``` |
| E1.3 | As a user, I can set radius (25m–50km) via input or presets | ```gherkin\nGiven the alarm card is open\nWhen I enter "1000" in radius field\nThen the radius is set to 1000 meters\n``` |
| E1.4 | As a user, I can save the alarm to favorites | ```gherkin\nGiven the alarm card is open\nWhen I check "Save to Favorites"\nThen the alarm appears in the Favorites panel\n``` |

### E2: Radius Selection (25m–50km)
| ID | User Story | Acceptance Criteria |
|----|------------|---------------------|
| E2.1 | Radius input accepts 25–50000 meters | ```gherkin\nGiven radius field\nWhen I enter "10"\nThen validation rejects (below 25m)\n``` |
| E2.2 | Preset chips: 100m, 250m, 500m, 1000m | ```gherkin\nGiven presets visible\nWhen I tap "500m"\nThen radius field updates to 500\n``` |

### E3: Favorites (Save/Reuse Locations)
| ID | User Story | Acceptance Criteria |
|----|------------|---------------------|
| E3.1 | Save alarm as favorite with custom label | ```gherkin\nGiven alarm created with "Save to Favorites"\nWhen I open Favorites panel\nThen the favorite appears with label and radius\n``` |
| E3.2 | Activate favorite creates new alarm at that location | ```gherkin\nGiven favorite exists\nWhen I tap it\nThen a new alarm is created at that coordinate\n``` |
| E3.3 | Delete favorite removes it | ```gherkin\nGiven favorite exists\nWhen I tap delete\nThen it disappears from panel\n``` |

### E4: AI Prompt Parsing ("Wake me 1km before airport")
| ID | User Story | Acceptance Criteria |
|----|------------|---------------------|
| E4.1 | Natural language prompt → destination + radius + coordinates | ```gherkin\nGiven AI input "Wake me 1km before airport"\nWhen I submit\nThen destination resolves to airport name\nAnd radius = 1000m\nAnd latitude/longitude are valid\n``` |
| E4.2 | Fallback to regex + Photon geocoder when Groq unavailable | ```gherkin\nGiven Groq API key not configured\nWhen I submit prompt\nThen regex extracts radius\nAnd Photon geocodes destination\n``` |

### E5: Authentication (Google OAuth + Password)
| ID | User Story | Acceptance Criteria |
|----|------------|---------------------|
| E5.1 | Google Sign-In returns JWT | ```gherkin\nGiven Google button clicked\nWhen I select account\nThen JWT stored in localStorage\nAnd Authorization header sent on requests\n``` |
| E5.2 | Password registration/login works | ```gherkin\nGiven register form\nWhen I submit email/password\nThen account created with bcrypt hash\nAnd JWT returned\n``` |
| E5.3 | JWT used for both REST and Socket.IO | ```gherkin\nGiven valid JWT\nWhen I connect to Socket.IO\nThen handshake auth succeeds\n``` |

### E6: Alarm Lifecycle (ACTIVE → TRIGGERED → DISMISSED)
| ID | User Story | Acceptance Criteria |
|----|------------|---------------------|
| E6.1 | Alarm created as ACTIVE | ```gherkin\nGiven alarm created\nWhen I list alarms\nThen status = ACTIVE\n``` |
| E6.2 | Entering geofence triggers alarm once | ```gherkin\nGiven ACTIVE alarm at location\nWhen GPS enters radius\nThen status → TRIGGERED\nAnd siren plays\nAnd alarm:trigger event fired\n``` |
| E6.3 | Concurrent GPS pings fire only once | ```gherkin\nGiven ACTIVE alarm\nWhen multiple GPS fixes inside radius\nThen only one TRIGGERED transition\n``` |
| E6.4 | User can dismiss → DISMISSED | ```gherkin\nGiven TRIGGERED alarm\nWhen user taps "Stop"\nThen status → DISMISSED\n``` |

### E7: Sound Presets + Custom MP3 + Vibration
| ID | User Story | Acceptance Criteria |
|----|------------|---------------------|
| E7.1 | 8 synth presets (3 iOS, 3 Android, 2 Gentle) | ```gherkin\nGiven settings open\nWhen I browse sounds\nThen 8 presets grouped by style\n``` |
| E7.2 | Custom MP3 upload plays as alarm | ```gherkin\nGiven MP3 file selected\nWhen alarm triggers\nThen custom audio loops\n``` |
| E7.3 | Vibration pattern per preset (where supported) | ```gherkin\nGiven vibration enabled\nWhen alarm triggers\nThen navigator.vibrate fires with preset pattern\n``` |

---

## 4. Non-Functional Requirements

| Category | Requirement | Target |
|----------|-------------|--------|
| **Platform** | Web-only (Expo SDK 57) | No native builds |
| **Security** | HTTPS required for geolocation | Production only |
| **Latency** | Trigger within 1s of geofence entry | < 1s |
| **Audio** | Offline-capable Web Audio synthesis | Works offline after load |
| **Accessibility** | ARIA labels, 44px tap targets, focus rings | WCAG 2.1 AA |
| **Data Ownership** | User-scoped alarms/favorites | Row-level ownership |
| **Cost Bounds** | Groq timeout 4s, Photon 5s, max_tokens 200 | Predictable cost |
| **Cache** | Redis 60s alarm cache, PG fallback | < 50ms reads |

---

## 5. Acceptance Criteria (Gherkin)

### Feature: Alarm Creation
```gherkin
Feature: Drop-pin alarm creation
  As a commuter
  I want to drop a pin and set a radius
  So that I wake up at my stop

  Scenario: Create alarm with manual pin
    Given the map is centered on my route
    When I long-press the map at "Central Station"
    And I set radius to "500"
    And I enter title "Central Station"
    And I tap "Activate Alarm Guard"
    Then an alarm is created with status ACTIVE
    And the pin appears on the map with a 500m circle

  Scenario: Create alarm from favorite
    Given a favorite "Home" exists at [lat, lng] radius 500
    When I open Favorites panel
    And I tap "Home"
    Then a new alarm is created at Home's coordinates
    And status is ACTIVE
```

### Feature: AI Prompt Parsing
```gherkin
Feature: Natural language alarm creation
  As a user
  I want to describe my destination in plain language
  So that I don't need to manually drop pins

  Scenario: Parse prompt with explicit radius
    Given I enter "Wake me 1km before airport"
    When I submit the AI prompt
    Then destination resolves to "Airport"
    And radius = 1000
    And coordinates are valid lat/lng

  Scenario: Fallback when Groq unavailable
    Given GROQ_API_KEY is not set
    When I enter "Wake me 500m before library"
    Then regex extracts radius = 500
    And Photon geocodes "library" to coordinates
```

### Feature: Geofence Trigger
```gherkin
Feature: Geofence triggers alarm
  As a sleeping commuter
  I want the alarm to fire exactly once when I arrive
  So that I don't miss my stop

  Scenario: Single trigger on entry
    Given an ACTIVE alarm at [lat, lng] radius 500
    And my GPS reports position inside radius
    When the server processes location:update
    Then alarm status becomes TRIGGERED
    And alarm:trigger event is emitted to my socket
    And siren audio starts playing

  Scenario: No duplicate triggers
    Given an ACTIVE alarm
    And my GPS sends 5 updates inside radius within 2 seconds
    When server processes each
    Then only one TRIGGERED transition occurs
    And only one alarm:trigger event is emitted
```

### Feature: Sound & Vibration
```gherkin
Feature: Alarm sounds and vibration
  As a heavy sleeper
  I want loud, distinctive sounds and phone vibration
  So that I wake up reliably

  Scenario: Synth preset plays with escalation
    Given sound = "Radar" (iOS style)
    And alarm triggers
    Then Web Audio plays pattern with 4-cycle escalation
    And volume increases from 60% to 100%
    And pattern tightens by 6%

  Scenario: Vibration fires with pattern
    Given vibration enabled in settings
    And alarm triggers with "Radar"
    Then navigator.vibrate([180,120,180]) fires
    And repeats every 2 seconds
```

---

## 6. Constraints & Risks

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| **Web-only** | No native iOS/Android | Documented; future roadmap for native |
| **HTTPS required** | Geolocation blocked on HTTP | Enforced in production; localhost exception |
| **Tile fair-use** | OSM/Esri tiles may throttle | Monitor usage; consider paid tiles for scale |
| **Audio gesture** | Web Audio blocked until user interaction | Unlock on first tap (play button, map click) |
| **No native builds** | Expo refuses iOS/Android | `platforms: ["web"]` in app.json |
| **Single Socket.IO instance** | No horizontal scaling yet | Add `@socket.io/redis-adapter` for multi-instance |

---

## 7. Future Roadmap

| Phase | Feature | Effort |
|-------|---------|--------|
| **v1.1** | Native iOS/Android (expo-location, react-native-maps, expo-audio) | High |
| **v1.2** | PWA with service worker (offline map tiles, background sync) | Medium |
| **v1.3** | Push notifications (Web Push API) for background alarms | Medium |
| **v1.4** | Multi-device sync (same alarm on phone + desktop) | Medium |
| **v2.0** | Shared alarms (family/carpool), recurring schedules, analytics dashboard | High |

---

## Appendix: Glossary

| Term | Definition |
|------|------------|
| **ACTIVE** | Alarm is armed and monitoring geofence |
| **TRIGGERED** | Geofence entered; alarm fired once |
| **DISMISSED** | User acknowledged trigger; alarm silenced |
| **Geofence** | Circular area (lat/lng + radius) around a destination |
| **Socket.IO Room** | `user:${userId}` — per-user broadcast channel |
| **AI Parse** | Groq LLM + Photon geocoder pipeline |
| **Escalation** | Alarm volume/tempo increases over first N cycles |