# 🎙️ Meet Arty, your Voice-Powered Mobile Assistant

[![TestFlight](https://img.shields.io/badge/TestFlight-available-blue)](https://testflight.apple.com/join/DyK83gVd) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/vibemachine-labs/arty) [![Snyk](https://snyk.io/test/github/vibemachine-labs/arty/badge.svg)](https://snyk.io/test/github/vibemachine-labs/arty)
[![OSSF Scorecard](https://github.com/vibemachine-labs/arty/actions/workflows/scorecard-pr.yml/badge.svg)](https://github.com/vibemachine-labs/arty/actions/workflows/scorecard-pr.yml) ![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/vibemachine-labs/arty?utm_source=oss&utm_medium=github&utm_campaign=vibemachine-labs%2Farty&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

An open-source voice assistant for mobile with real-time API integration. Think "Ollama for mobile + realtime voice."

Connects to your Google Drive, DeepWiki, Hacker News, Daily Hugging Face Top Papers, and the web. 

It's currently a thin wrapper around the OpenAI Realtime speech API, however the long term vision is to make it extensible and pluggable, with a fully open source and privacy-first stack. To keep all data within your cloud perimeter, Azure OpenAI Private Endpoint can be configured as an alternative deployment option.

If this sounds interesting, [⭐️ the project on GitHub](https://github.com/vibemachine-labs/arty/stargazers) to help it grow.

## 🎤 Demo audio - browse hacker news (1 min 30 secs)

https://github.com/user-attachments/assets/0c735cc8-317c-407a-8db1-0f02b65533ae

<details>
  <summary>Whats's in the demo</summary>

  - "What are top storiees on hacker news?"
  - "What are commetns about montana law story?"
  - "SUmmarize new montana law"

</details>

## 🎥 Demo Reel (80 seconds)

https://github.com/user-attachments/assets/6171b7d1-ef97-483b-ba09-d6854babc726

or view the [full resolution version](https://vimeo.com/manage/videos/1127547235)

## 📱 Screenshots

<table style="border-collapse:collapse; border-spacing:0; border:none; margin:0 auto;">
  <tr>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Voice chat home screen" src="https://github.com/user-attachments/assets/16cebc15-46bc-4e9a-8896-17355d079967" />
      <div>Voice chat (home screen)</div>
    </td>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Text chat conversation" src="https://github.com/user-attachments/assets/23a68aad-9b6b-4b21-aebb-2cc73c83530d" />
      <div>Text chat</div>
    </td>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Configure connectors screen" src="https://github.com/user-attachments/assets/5270b4ce-0951-45df-b7b0-9d1ae6402f5d" />
      <div>Configure connectors</div>
    </td>
  </tr>
</table>

## 🎯 Why This Project Was Created

Voice AI is now incredibly powerful when connected to your data, yet current solutions are closed source, compromise your privacy, and are headed toward ads and lock-in.

This project offers a fully open alternative: local execution, no data monetization, and complete control over where your data goes.

## ▶️ Install it via TestFlight

[<img src="https://github.com/user-attachments/assets/33a4ed30-f00d-4639-9389-022d8f9bf581" alt="Join the TestFlight beta" width="220" />](https://testflight.apple.com/join/DyK83gVd)

[Test Flight Installation](https://testflight.apple.com/join/DyK83gVd)

> **Security note:** TestFlight builds are compiled binaries; do not assume they exactly match this source code. If you require verifiability, build from source and review the code before installing.

<details>
  <summary>Getting Started Instructions</summary>

<ol>
  <li>
    <strong>Create a new OpenAI API key.</strong> Grant the minimum realtime permissions shown below: (Models read, Model capabilities write)
    <div><img width="250" alt="OpenAI key scopes step 1" src="https://github.com/user-attachments/assets/6edf15d0-6890-4134-86d8-699423deb051" /></div>
  </li>
  <li>
    <strong>Grant access to Responses API.</strong> 
    <div><img width="250" alt="OpenAI key scopes step 2" src="https://github.com/user-attachments/assets/17edde61-f245-40e4-94cf-357ee19e5b26" /></div>
  </li>
  <li>
    <strong>Paste the key into the onboarding wizard and tap Next.</strong>
    <div><img width="250" alt="Onboarding wizard OpenAI key entry" src="https://github.com/user-attachments/assets/96aee5ed-36f4-467e-b401-45bb5adf5dd7" /></div>
  </li>
  <li>
    <strong>Connect Google Drive so Arty can see your files.</strong> OAuth tokens stay on-device. See
    <a href="#-security--privacy">Security + Privacy</a> for details.
    <div><img width="250" alt="Google Drive permission prompt" src="https://github.com/user-attachments/assets/15e14c92-7e4a-49be-b0ac-197bf5c060fd" /></div>
  </li>
  <li>
    <strong>Choose the Google account you want to use.</strong>
    <div><img width="250" alt="Google account selection" src="https://github.com/user-attachments/assets/a1b101df-c398-479d-aaa3-3e211229cc5a" /></div>
  </li>
  <li>
    <strong>Tap “Hide Advanced” and then “Go to vibemachine (unsafe).”</strong>
    <div><img width="250" alt="Google Drive advanced warning" src="https://github.com/user-attachments/assets/d4df2ff5-d0de-474d-88f9-da684678ba0d" /></div>
  </li>
  <li>
    <strong>Review the OAuth scopes that Arty is requesting.</strong>
    <div><img width="250" alt="Google Drive scopes" src="https://github.com/user-attachments/assets/519bc402-edbf-4853-a29f-d955380bcf52" /></div>
  </li>
  <li>
    <strong>Confirm the connection.</strong> You should see a success screen when Drive is linked.
    <div><img width="250" alt="Google Drive connected confirmation" src="https://github.com/user-attachments/assets/54f1d949-2c23-4ff5-bf1d-5ec8845de9d1" /></div>
  </li>
  <li>
    <strong>Optional: Provide your own Google Drive Client ID for extra control.</strong>
    <div><img width="250" alt="Custom Google Drive client ID" src="https://github.com/user-attachments/assets/364bd8ab-54ca-4e7e-b9b1-6b725773c019" /></div>
  </li>
  <li>
    <strong>Finish the onboarding wizard.</strong>
    <div><img width="250" alt="Onboarding completion screen" src="https://github.com/user-attachments/assets/f05a65b9-7154-4f79-952c-9a71a969ffee" /></div>
  </li>
  <li>
    <strong>Start chatting with Arty.</strong>
    <div><img width="250" alt="Voice chat home screen" src="https://github.com/user-attachments/assets/590ab28c-9609-4486-a132-5e3344e2d5d7" /></div>
  </li>
</ol>

</details>

<details>
  <summary>How to get the most out of it</summary>

- Personalize Arty: adjust the system prompt, voice, VAD mode, and tool configuration from the Advanced settings sheets to match your workflow.
- Try out text chat mode when you can't use voice.  Under settings, configure it to use text chat mode.  Note, there's no streaming token support yet, so it feels pretty slow.
- Explore the connectors: Enable DeepWiki for documentation search, Hacker News for tech news, and Daily Hugging Face Top Papers for the latest AI research.

</details>

## ✨ Features

1. **Supports several connectors: Google Drive, DeepWiki, Hacker News, Daily Hugging Face Top Papers, and Web Search** - Voice assistant that can summarize content in Google Drive, search documentation with DeepWiki, browse Hacker News, discover the latest AI research papers, and search the web
2. **Extensible** - Adding connectors is fairly easy.  File an issue to request the connector you'd want to see.
3. **Customizable prompts** - Edit system and tool prompts directly from the UI
4. **Multi-mode audio** - Works with speaker, handset, or Bluetooth headphones
5. **Background noise handling** - Mute yourself in loud environments
6. **Session recording** - Optional conversation recording and sharing
7. **Voice and text modes** - Switch between input methods seamlessly
8. **Observability** - Optional Logfire integration for debugging (disabled by default)
9. **Privacy-focused** - Working toward a fully private solution with local execution options


## 🚧 Limitations

1. **Cost** - OpenAI API costs can add up with extended usage due to context window management
2. **Text Mode is limited** - The Text mode does not support streaming tokens yet.  It has a very basic and limited UX.
3. **Platform** - iOS only, no Android support yet due to currently using native WebRTC library, despite using React Native via Expo.
4. **UX** - No progress indicators during operations
5. **Recording** - Optional call recording implementation doesn't work very reliably since it regenerates the conversation based on a text transcript

## 🔐 Security + Privacy

> **Privacy status:** We're actively working toward a fully private, end-to-end local solution. Currently, the app uses OpenAI's API, which means user prompts and connector content are transmitted to OpenAI by design. Your credentials (API keys, OAuth tokens) never leave your device and are stored securely in iOS Keychain. Future updates will add support for self-hosted and fully local execution options.

To keep all data within your cloud perimeter, Azure OpenAI Service with Private Link can be configured to ensure traffic remains within your virtual network infrastructure.

**From a security perspective, the main risks are credential leakage or abuse**:

1. OpenAI API Key
2. Google Drive Auth Token

**Mitigation:** All credentials remain on-device, stored only in memory or secure storage (iOS Keychain). Audit the source code to verify that no credentials are transmitted externally.

<details>
  <summary>Security + privacy: storage, scopes, and network flow recap</summary>

- All token storage in memory and secure storage happens in `lib/secure-storage.ts`
- The actual saving/retrieval of tokens is delegated to the Expo library `expo-secure-store`
- Transport security: All outbound requests to OpenAI, Google, and optional Logfire use HTTPS with TLS handled by each provider. This project does not introduce custom proxies or MITM layers.
- OAuth tokens and API keys are stored via `expo-secure-store`, which maps to the iOS Keychain using the `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` accessibility level. Tokens are never written to plaintext disk.
- Recording is off by default, and conversation transcripts are not saved. Optional recordings remain on-device and rely on standard iOS filesystem encryption.
- No third-party endpoints beyond OpenAI, Google, and optional Logfire are contacted at runtime. The app does not embed analytics, crash reporting SDKs, or ad networks.

- The Google Drive OAuth scope used by the default Client ID in the TestFlight build is read-only—it can create or edit files that the app created, but cannot edit or delete files that originated elsewhere. For tighter control, register your own Google Drive app, supply its Client ID, and grant the permissions you deem appropriate.
- Assume that connector operations which retrieve file contents may send that content to the LLM for summarization unless you have deliberately disabled that behavior.

Observability logs are disabled by default. Note that these should be automatically scrubbed of API tokens by Logfire itself. Only enable Logfire after you have audited the code and feel comfortable—this is mainly a developer feature and not recommended for casual usage or testing.

Out of scope: This project does not currently defend against (1) on-device compromise, (2) malicious LLM responses executing actions against connected services using delegated tokens, or (3) interception of API traffic by the model provider.

</details>


## 🛠️ Building from source

<details>
  <summary>Installation steps</summary>

### Clone project and install dependencies

```bash
git clone https://github.com/vibemachine-labs/arty.git
cd arty
curl -fsSL https://bun.sh/install | bash
bun install
```

### Create a Google Drive Client ID

When building from source, you will need to provide your own Google Drive Client ID.  You can decide the permissions you want to give it, as well as whether you want to go through the verification process.

[Google API Instructions](https://support.google.com/cloud/answer/15549257)

For testing, the following oauth scopes are suggested:

1. See and download your google drive files (included by default)
1. See, edit, create, and delete only the specific Google Drive files you use with this app

### Run the app

To run in the iOS simulator:

```bash
bunx expo run:ios
```

⚠️ Audio is flaky on the iOS Simulator.  Using a real device is highly recommended.

To run on a physical device:

```bash
bunx expo run:ios --device
```

</details>

<details>
  <summary>Editing Swift code in Xcode</summary>

### Open Xcode project

To open the project in Xcode:

```bash
xed ios
```

In Xcode, the native swift code will be under **Pods / Development Pods**

</details>

<details>
  <summary>Misc Dev Notes</summary>


### Disable onboarding wizard (optional)

For certain testing scenarios, disable the onboarding wizard by editing `app/index.tsx` and commenting out the `useEffect` block that evaluates onboarding status:

```typescript
useEffect(() => {
  let isActive = true;

  const evaluateOnboardingStatus = async () => {
    try {
      const storedKey = await getApiKey();
      const hasStoredKey = typeof storedKey === "string" && storedKey.trim().length > 0;
      if (!isActive) {
        return;
      }
      setOnboardingVisible(!hasStoredKey);
    } catch (error) {
      if (!isActive) {
        return;
      }
      log.warn("Unable to determine onboarding status from secure storage", error);
      setOnboardingVisible(true);
    }
  };

  if (!apiKeyConfigVisible) {
    void evaluateOnboardingStatus();
  }

  return () => {
    isActive = false;
  };
}, [apiKeyConfigVisible, onboardingCheckToken]);
```

### Development notes

- Project bootstrapped with `bunx create-expo-app@latest .`
- Refresh dependencies after pulling new changes: `bunx expo install`
- Install new dependencies: `bunx expo install <package-name>`
- Allow LAN access once: `bunx expo start --lan`

### Run on iOS device via ad hoc distribution

1. Register device: `eas device:create`
2. Scan the generated QR code on the device and install the provisioning profile via Settings.
3. Configure build: `bunx eas build:configure`
4. Build: `eas build --platform ios --profile dev_self_contained`

### Clean build

If pods misbehave, rebuild from scratch:

```bash
bunx expo prebuild --clean --platform ios
bunx expo run:ios
```

</details>


## ⚙️ Technical Details

<details>
  <summary>Architecture overview</summary>

### Native Swift WebRTC Client

React Native WebRTC libraries did not reliably support speakerphone mode during prototyping. The native Swift implementation resolves this issue but adds complexity and delays Android support.

### Connector Architecture

All connectors use statically defined tools with explicit function definitions, providing reliability and predictable behavior. Examples include Google Drive file operations, DeepWiki documentation search, Hacker News browsing, and Daily Hugging Face Top Papers discovery.

### MCP Support

Not yet implemented since all tools are currently local. Future versions will add MCP server support via cloud or local tunnel connections.

### Web Search

GPT-4 web search serves as a temporary solution. The roadmap includes integrating a dedicated search API (e.g., Brave Search) using user-provided API tokens.

### Voice / Text LLM backend

OpenAI is currently the only supported backend. Adding support for multiple providers and self-hosted backends is on the roadmap.

</details>

## 🗺️ Roadmap

1. Address limitations listed above
1. Improve text mode support
1. Investigate async voice processing to reduce cost
1. Add support for alternative voice providers ([Unmute.sh](https://unmute.sh/), [Speaches.ai](https://speaches.ai), self-hosted)
1. Remote MCP integration
1. TypeScript MCP plugin support

## 💼 Business Model

**The app itself will remain completely open source, with no restrictions or limitations.**

**Business model TBD.** Likely a managed backend service using either:

* Azure OpenAI realtime APIs
* Fully open-source stack — possibly [Unmute.sh](https://unmute.sh/) or [Speaches.ai](https://speaches.ai)

## 🤝 How You Can Help

- **Spread the word** - Star [github.com/vibemachine-labs/arty](https://github.com/vibemachine-labs/arty), share with friends
- **Try it** - Run the app and file issues
- **Give feedback** - Fill out a [quick questionnaire](https://tally.so/r/mJNgqK) (10 questions, 2 mins) or [schedule a 15-min user interview](https://cal.com/tleyden/15-min-whenever)
- **Contribute ideas** - File issues with appropriate labels
- **Create pull requests** - For larger proposed changes, it's probably better to file an issue first


## 📬 Contact & Feedback

- **Email/Twitter:** Email or Twitter/X via my [Github profile](https://github.com/tleyden).
- **Issues, Ideas:** Submit bugs, feature requests, or connector suggestions on GitHub Issues.
- **Discord:** A server will be launched if there’s enough interest.
- **Responsible disclosure:** Report security-relevant issues privately via email using the address listed on my [Github profile](https://github.com/tleyden) before any public disclosure.
