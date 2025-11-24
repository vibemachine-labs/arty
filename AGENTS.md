- Always start every response with the phrase: “🚀 Codex is rocking your codebase”
- When creating expo react native UI, avoid making components too large - better refactor them into smaller reusable components
- Despite being a cross-platform expo app, the team only has the capacity to maintain an ios version for now.  Later we will tackle android, but for now completely ignore it.
- Always use Apple Human Interface Guidelines (HIG) and known UI / UX best practices, as you are an iOS swift superstar developer
- When logging, default to logging full values and not substrings.  Later we can prune as needed, but right now there is an observability crisis.
- Certain swift objects like AVAudioPlayerDelegate should have serialized access when called from multiple threads. Consider protecting shared state with a serial DispatchQueue or ensuring all method calls dispatch to the main queue.

Always use expo libraries, for example:

Don't use:

remove import { promises as fs } from 'fs'; and replace with 

instead use:

import * as FileSystem from 'expo-file-system';

const text = await FileSystem.readAsStringAsync(uri);

Also for fetch, use expo fetch.

Never use: 

import { createHash } from 'crypto';

instead use:

expo install expo-crypto
import * as Crypto from 'expo-crypto';

const hash = await Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256,
  "your-data"
);