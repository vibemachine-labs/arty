# 🎙️ Meet Arty, your Voice-Powered Mobile Assistant

[![TestFlight](https://img.shields.io/badge/TestFlight-available-blue)](https://testflight.apple.com/join/DyK83gVd)
[![OSSF Scorecard](https://github.com/vibemachine-labs/arty/actions/workflows/scorecard-pr.yml/badge.svg)](https://github.com/vibemachine-labs/arty/actions/workflows/scorecard-pr.yml)
[![Snyk](https://snyk.io/test/github/vibemachine-labs/arty/badge.svg)](https://snyk.io/test/github/vibemachine-labs/arty)

An open-source, privacy-first voice assistant for mobile with real-time API integration. Think "Ollama for mobile + realtime voice."

Connects to your Google Drive, Github, and the web. 

It's currently a thin wrapper around the OpenAI Realtime speech API, however the long term vision is to make it extensible and pluggable, with a fully open source stack.

## 🎥 Demo Reel (80 seconds)

(Does not play directly, this links to a Vimeo.  Open in a new tab.)

<a href="https://vimeo.com/manage/videos/1127547235" target="_blank">
  <img src="https://github.com/user-attachments/assets/3d0f9b19-54dc-45c2-888b-223e05fb46f4" alt="Demo video">
</a>

<details>
  <summary>Whats's in the demo</summary>

  1. Navigate Google Drive via voice: "Find all files with the name vibemachine in it"
  2. Have the app summarize contents of a document in Google Drive: "Summarize the contents of the vibemachine design doc"
  3. File a Github issue: "Create a new issue to update design doc" 
  4. Show phone with github issue actually filed.

</details>

## 📱 Screenshots

<table style="border-collapse:collapse; border-spacing:0; border:none; margin:0 auto;">
  <tr>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Voice chat home screen" src="https://github.com/user-attachments/assets/71eafec2-8979-4455-9852-29e9ef0d0335" />
      <div>Voice chat (home screen)</div>
    </td>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Text chat conversation" src="https://github.com/user-attachments/assets/c2c390a5-2a40-46b5-a29d-a243be0886b3" />
      <div>Text chat</div>
    </td>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Configure connectors screen" src="https://github.com/user-attachments/assets/a9406767-d6fa-4284-a813-1e029ad1b345" />
      <div>Configure connectors</div>
    </td>
  </tr>
</table>

## 🎯 Why This Project Was Created

Voice AI is now incredibly powerful when connected to your data, yet current solutions are closed source, compromise your privacy, and are headed toward ads and lock-in.

This project offers a fully open alternative: local execution, no data monetization, and complete control over where your data goes.

## ▶️ Install it via TestFlight

[<img src="https://github.com/user-attachments/assets/8d82e676-b913-45a5-91e4-f37e1df99e97" alt="Join the TestFlight beta" width="220" />](https://testflight.apple.com/join/DyK83gVd)

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

- Connect your GitHub account: open the Hamburger Menu → Configure Connectors → GitHub and add a Personal Access Token. When creating the PAT, the recommended scopes are <code>gist</code>, <code>read:org</code>, and <code>repo</code>.
- Personalize Arty: adjust the system prompt, voice, VAD mode, and tool configuration from the Advanced settings sheets to match your workflow.
- Try out text chat mode when you can't use voice.  Under settings, configure it to use text chat mode.  Note, there's no streaming token support yet, so it feels pretty slow.

</details>

## ✨ Features

1. **Supports several connectors: Google Drive, Github, and Web Search** - Voice assistant that can summarize content in Google Drive, interact with Github, and search the web
3. **Extensible** - Adding connectors is fairly easy.  File an issue to request the connector you'd want to see.
4. **Customizable prompts** - Edit system and tool prompts directly from the UI
5. **Multi-mode audio** - Works with speaker, handset, or Bluetooth headphones
6. **Background noise handling** - Mute yourself in loud environments
7. **Session recording** - Optional conversation recording and sharing
8. **Voice and text modes** - Switch between input methods seamlessly
9. **Observability** - Optional Logfire integration for debugging (disabled by default)
10. **Privacy-first** - No server except connected services—your data stays yours


## 🚧 Limitations

1. **Cost** - High OpenAI API costs due to poor context window management and fallback strategies
1. **Text Mode is limited** - The Text mode does not support streaming tokens yet.  It has a very basic and limited UX.
1. **Platform** - iOS only, no Android support yet due to currently using native WebRTC library, despite using React Native via Expo.  
1. **Performance** - Codegen is slow and unreliable. Most functionality should be moved to static tools
1. **UX** - No progress indicators during operations
1. **Security** - Dynamic codegen poses risks. Mitigation: use read-only access for connected services
1. **Recording** - Optional call recording implementation doesn't work very reliably since it regenerates the conversation based on a text transcript

## 🔐 Security + Privacy

> **Important note:** Although tokens never leave the device, some user prompts and connector content are transmitted to the OpenAI Realtime API by design. If you require strict local-only execution, do not use this app. Watch for future updates that support fully self-contained usage or privately hosted models instead.

**From a security perspective, the main risks are credential leakage or abuse**:

1. OpenAI API Key
1. Google Drive Auth Token
1. GitHub PAT

**Mitigation:** All credentials remain on-device, stored only in memory or secure storage (iOS Keychain). Audit the source code to verify that no credentials are transmitted externally.

<details>
  <summary>Security + privacy: storage, scopes, and network flow recap</summary>

- All token storage in memory and secure storage happens in `lib/secure-storage.ts`
- The actual saving/retrieval of tokens is delegated to the Expo library `expo-secure-store`
- Transport security: All outbound requests to OpenAI, Google, GitHub, and Logfire use HTTPS with TLS handled by each provider. This project does not introduce custom proxies or MITM layers.
- Prompt-injection and mis-issuance: The app does not currently detect or prevent malicious model output from executing unexpected write actions. Use read-only scopes wherever possible.
- OAuth tokens and API keys are stored via `expo-secure-store`, which maps to the iOS Keychain using the `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` accessibility level. Tokens are never written to plaintext disk.
- Recording is off by default, and conversation transcripts are not saved. Optional recordings remain on-device and rely on standard iOS filesystem encryption.
- No third-party endpoints beyond OpenAI, Google, GitHub, and optional Logfire are contacted at runtime. The app does not embed analytics, crash reporting SDKs, or ad networks.

- The Google Drive OAuth scope used by the default Client ID in the TestFlight build is read-only—it can create or edit files that the app created, but cannot edit or delete files that originated elsewhere. For tighter control, register your own Google Drive app, supply its Client ID, and grant the permissions you deem appropriate.
- When creating a GitHub Personal Access Token, choose scopes based on your comfort level. Enable write scopes (for example, issue creation) explicitly—they are not required for basic usage.
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

In Xcode, the project appears under **Pods / Development Pods**:

![Xcode Development Pods](https://github.com/user-attachments/assets/bea7ee11-3cd6-4a7a-a620-a273a01ce316)

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

### Codegen vs Static Tools

Dynamic code generation currently powers connector operations, enabling rapid prototyping. Long-term, the plan is to transition to statically defined tools with codegen as a fallback option.

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
