#!/usr/bin/env bun

import { spawn } from "bun";
import { createInterface } from "readline";
import { promises as fs } from "fs";
import path from "path";

interface BuildOption {
  name: string;
  flag: string;
  command: string;
  description: string;
  customHandler?: () => Promise<number>;
}

// Directories containing WebRTC headers that require patching.
const HEADER_DIRS = [
  'ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-arm64/WebRTC.framework/Headers',
  'ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-x86_64_arm64-simulator/WebRTC.framework/Headers',
];

async function patchHeaderDirectory(relativeDir: string): Promise<void> {
  const absoluteDir = path.resolve(process.cwd(), relativeDir);
  try {
    await fs.access(absoluteDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    console.warn(`\n⚠️  Skipping ${relativeDir}: directory not found or inaccessible.`);
    return;
  }

  const targetDir = path.join(absoluteDir, 'sdk/objc/base');
  await fs.mkdir(targetDir, { recursive: true });

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const { name } = entry;
    if (name === 'sdk') {
      continue;
    }

    if (entry.isDirectory()) {
      continue;
    }

    const source = path.join(absoluteDir, name);
    const destination = path.join(targetDir, name);

    try {
      await fs.link(source, destination);
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        continue;
      }
      throw new Error(`Failed to link ${name} in ${relativeDir}: ${err.message}`);
    }
  }

  console.log(`\n✅ Patched headers in ${relativeDir}`);
}

async function patchHeaders(): Promise<number> {
  console.log('\nPatching WebRTC-lib headers...');
  try {
    for (const dir of HEADER_DIRS) {
      await patchHeaderDirectory(dir);
    }
    console.log('\n🎉 All done!');
    return 0;
  } catch (err: any) {
    console.error(`\n❌ ${err.message}`);
    return 1;
  }
}

const BUILD_OPTIONS: BuildOption[] = [
  {
    name: "Patch WebRTC Headers",
    flag: "patch-webrtc",
    command: "",
    description: "Patch WebRTC-lib headers for iOS",
    customHandler: patchHeaders,
  },
  {
    name: "EAS Build Dev",
    flag: "eas-build-dev",
    command: "eas build --platform ios --profile dev_self_contained --non-interactive",
    description: "Build iOS app with dev_self_contained profile",
  },
  {
    name: "EAS Build Dev Local",
    flag: "eas-build-dev-local",
    command: "eas build --platform ios --profile dev_self_contained --non-interactive --local",
    description: "Build iOS app locally with dev_self_contained profile",
  },
  {
    name: "EAS Update Dev",
    flag: "eas-update-dev",
    command: 'eas update --platform ios --branch dev_self_contained --message "Update"',
    description: "Push an OTA update to dev_self_contained branch",
  },
  {
    name: "Clean Build",
    flag: "clean-build",
    command: "CI=1 bunx expo prebuild --clean --platform ios",
    description: "Clean prebuild for iOS",
  },
  {
    name: "EAS Build Prod",
    flag: "eas-build-prod",
    command: "eas build --platform ios --profile production --non-interactive && eas submit --platform ios",
    description: "Build and submit iOS app to App Store",
  },
];

async function executeCommand(command: string): Promise<number> {
  console.log(`\n🚀 Executing: ${command}\n`);

  const proc = spawn({
    cmd: ["sh", "-c", command],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;
  return exitCode;
}

function showMenu(): void {
  console.log("\n=== Arty Build Wizard ===\n");
  BUILD_OPTIONS.forEach((option, index) => {
    console.log(`${index + 1}) ${option.name}`);
    console.log(`   ${option.description}`);
    console.log(`   Flag: bun run wizard ${option.flag}\n`);
  });
  console.log("0) Exit");
}

async function executeChoice(choice: string): Promise<void> {
  const index = parseInt(choice) - 1;

  if (choice === "0" || choice === "") {
    console.log("\nGoodbye!");
    process.exit(0);
  }

  if (index >= 0 && index < BUILD_OPTIONS.length) {
    const option = BUILD_OPTIONS[index];
    console.log(`\n📦 ${option.name}`);

    const exitCode = option.customHandler
      ? await option.customHandler()
      : await executeCommand(option.command);

    if (exitCode === 0) {
      console.log(`\n✅ ${option.name} completed successfully!`);
      process.exit(0);
    } else {
      console.error(`\n❌ ${option.name} failed with exit code ${exitCode}`);
      process.exit(exitCode);
    }
  } else {
    console.log("\n❌ Unrecognized option.");
    process.exit(1);
  }
}

async function handleFlag(flag: string): Promise<void> {
  const option = BUILD_OPTIONS.find((opt) => opt.flag === flag);

  if (option) {
    console.log(`\n📦 ${option.name}`);

    const exitCode = option.customHandler
      ? await option.customHandler()
      : await executeCommand(option.command);

    if (exitCode === 0) {
      console.log(`\n✅ ${option.name} completed successfully!`);
      process.exit(0);
    } else {
      console.error(`\n❌ ${option.name} failed with exit code ${exitCode}`);
      process.exit(exitCode);
    }
  } else {
    console.error(`\n❌ Unknown flag: ${flag}`);
    console.log("\nAvailable flags:");
    BUILD_OPTIONS.forEach((opt) => {
      console.log(`  - ${opt.flag}: ${opt.description}`);
    });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  // Check if a flag was provided
  if (args.length > 0) {
    await handleFlag(args[0]);
    return;
  }

  // Interactive mode
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  showMenu();

  rl.question("\nSelect an option: ", async (answer) => {
    rl.close();
    const choice = answer.trim();
    await executeChoice(choice);
  });
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
