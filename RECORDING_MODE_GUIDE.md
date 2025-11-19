# Recording Mode Guide

## Overview

Recording Mode is a developer setting that switches the audio session configuration from voice-optimized (`.voiceChat` mode) to recording-compatible (`.default` mode with `.mixWithOthers` option). This prevents the "static audio" bug when capturing your WebRTC app's output using QuickTime or iOS Screen Recording.

## Why Recording Mode is Needed

**The Problem:**
- WebRTC apps using `AVAudioSessionModeVoiceChat` create a non-mixable audio session
- iOS Screen Recording and QuickTime need to tap into the system's "mixable audio bus"
- When an app uses a non-mixable session, the screen recorder cannot capture the audio stream
- Result: You get static or silence instead of actual audio

**The Solution:**
Recording Mode uses:
```swift
try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker])
```

This configuration:
- ✅ Allows iOS Screen Recording to capture your app's audio
- ✅ Allows QuickTime to capture audio when connected via USB
- ✅ Preserves WebRTC functionality (TTS output + microphone input)
- ✅ Forces speaker output for reliable recording

## How to Use

### 1. Enable Recording Mode

1. Open the app
2. Tap the hamburger menu (☰) in the top-left
3. Select "Developer Mode"
4. Toggle "Recording Mode" ON
5. Tap "Done"

The setting is persisted and will be applied automatically on next app launch.

### 2. Record with iOS Screen Recording

**From Control Center:**
1. Swipe down from top-right to open Control Center
2. Long-press the Screen Recording button (⏺)
3. Enable "Microphone" toggle if you want to capture your voice too
4. Tap "Start Recording"
5. Launch Arty and start your voice chat
6. Stop recording from Control Center or status bar

**Result:** The video will include both the TTS output and (optionally) your voice input.

### 3. Record with QuickTime (Mac + iPhone via USB)

**Setup:**
1. Connect iPhone to Mac via USB cable
2. Open QuickTime Player on Mac
3. File → New Movie Recording
4. Click the dropdown arrow next to the red record button
5. Set:
   - **Camera:** iPhone
   - **Microphone:** iPhone ← CRITICAL
6. Click record
7. Launch Arty on iPhone and start voice chat
8. Stop recording in QuickTime when done

**Result:** QuickTime captures the iPhone's output audio stream, including your WebRTC TTS output.

## Technical Details

### Normal Mode (Default)
```swift
configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
configuration.category = AVAudioSession.Category.playAndRecord.rawValue
configuration.categoryOptions = [.allowBluetooth, .defaultToSpeaker]
```
- Optimized for voice quality (echo cancellation, noise suppression)
- Non-mixable (prevents screen recording from capturing audio)
- Supports Bluetooth audio routing

### Recording Mode
```swift
configuration.mode = AVAudioSession.Mode.default.rawValue
configuration.category = AVAudioSession.Category.playAndRecord.rawValue
configuration.categoryOptions = [.mixWithOthers, .defaultToSpeaker]
```
- Mixable audio (allows screen recording to capture audio)
- Forces speaker output for consistent recording
- Does NOT allow Bluetooth routing (prevents capture issues)

## Tradeoffs

**Recording Mode:**
- ✅ Screen recordings work perfectly
- ✅ QuickTime captures audio correctly
- ❌ No Bluetooth audio support while recording
- ❌ Less aggressive voice processing (may have more echo/noise)

**Normal Mode:**
- ✅ Optimized voice quality
- ✅ Bluetooth audio routing works
- ❌ Screen recordings capture static instead of audio

## Recommendations

- **For demos/marketing videos:** Enable Recording Mode before recording
- **For regular usage:** Keep Recording Mode OFF for best voice quality
- **For testing:** Toggle as needed - the setting persists between app launches

## Implementation

The recording mode setting is stored in `AsyncStorage` and automatically applied at app startup via:

1. `lib/developerSettings.ts` - Storage functions
2. `components/ui/DeveloperMode.tsx` - UI toggle
3. `app/index.tsx` - Load preference at startup
4. `modules/vm-webrtc/ios/OpenAIWebRTCClient.swift` - Property + setter
5. `modules/vm-webrtc/ios/WebRtcClientHelpers.swift` - Audio session configuration

The setting is checked when configuring the audio session during WebRTC connection setup.
