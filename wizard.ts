#!/usr/bin/env bun

import { spawn } from "bun";
import { createInterface } from "readline";

interface BuildOption {
  name: string;
  flag: string;
  command: string;
  description: string;
}

const BUILD_OPTIONS: BuildOption[] = [
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
    const exitCode = await executeCommand(option.command);

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
    const exitCode = await executeCommand(option.command);

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
