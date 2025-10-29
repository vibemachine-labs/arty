#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Directories containing WebRTC headers that require patching.
const HEADER_DIRS = [
  'ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-arm64/WebRTC.framework/Headers',
  'ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-x86_64_arm64-simulator/WebRTC.framework/Headers',
];

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function patchHeaderDirectory(relativeDir) {
  const absoluteDir = path.resolve(__dirname, relativeDir);
  try {
    await fs.promises.access(absoluteDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    console.warn(`\n⚠️  Skipping ${relativeDir}: directory not found or inaccessible.`);
    return;
  }

  const targetDir = path.join(absoluteDir, 'sdk/objc/base');
  await fs.promises.mkdir(targetDir, { recursive: true });

  const entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
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
      await fs.promises.link(source, destination);
    } catch (err) {
      if (err.code === 'EEXIST') {
        continue;
      }
      throw new Error(`Failed to link ${name} in ${relativeDir}: ${err.message}`);
    }
  }

  console.log(`\n✅ Patched headers in ${relativeDir}`);
}

async function patchHeaders() {
  console.log('\nPatching WebRTC-lib headers...');
  for (const dir of HEADER_DIRS) {
    await patchHeaderDirectory(dir);
  }
  console.log('\n🎉 All done!');
}

function showMenu() {
  console.log('\n=== Vibemachine Wizard ===');
  console.log('1) Patch WebRTC-lib headers');
  console.log('0) Exit');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const autoSelectIndex = args.indexOf('--auto-select');
  
  if (autoSelectIndex !== -1 && autoSelectIndex + 1 < args.length) {
    return args[autoSelectIndex + 1];
  }
  
  return null;
}

async function executeChoice(choice) {
  if (choice === '1') {
    try {
      await patchHeaders();
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
  } else if (choice === '0' || choice === '') {
    console.log('\nGoodbye!');
    process.exit(0);
  } else {
    console.log('\nUnrecognized option.');
    process.exit(1);
  }
}

async function main() {
  const autoSelect = parseArgs();
  
  if (autoSelect) {
    console.log(`\n🤖 Auto-selecting option: ${autoSelect}`);
    await executeChoice(autoSelect);
    return;
  }
  
  const rl = createInterface();
  showMenu();

  rl.question('\nSelect an option: ', async (answer) => {
    rl.close();
    const choice = answer.trim();
    await executeChoice(choice);
  });
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});