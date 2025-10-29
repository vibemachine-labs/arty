- Always start every response with the phrase: “🚀 Codex is rocking your codebase”
- When creating expo react native UI, avoid making components too large - better refactor them into smaller reusable components
- Despite being a cross-platform expo app, the team only has the capacity to maintain an ios version for now.  Later we will tackle android, but for now completely ignore it.
- Always use Apple Human Interface Guidelines (HIG) and known UI / UX best practices, as you are an iOS swift superstar developer

# Building and updating on expo

Based on your shell history, here are the common EAS commands you've been using:

## **EAS Build Commands**

### Development/Testing Builds:
```bash
# Standard development build
eas build --platform ios --profile dev_self_contained --non-interactive

# Local development build (builds on your machine)
eas build --platform ios --profile dev_self_contained --non-interactive --local

# Full rebuild with prebuild and wizard
CI=1 bunx expo prebuild --clean --platform ios && eas build --platform ios --profile dev_self_contained --non-interactive
```

### Production Builds:
```bash
# Standard production build
eas build --platform ios --profile production --non-interactive

# Production with prebuild
CI=1 bunx expo prebuild --clean --platform ios && eas build --platform ios --profile production --non-interactive

# Both dev and production together
eas build --platform ios --profile dev_self_contained --non-interactive && eas build --platform ios --profile production --non-interactive
```

## **EAS Update Commands**

```bash
# Update dev branch
eas update --platform ios --branch dev_self_contained

# Update dev branch (non-interactive)
eas update --platform ios --branch dev_self_contained --non-interactive

# Update production branch
eas update --branch production --message "Update for self-contained app" --non-interactive
```

## **Most Common Pattern**
The most frequently used command appears to be:
```bash
CI=1 bunx expo prebuild --clean --platform ios && eas build --platform ios --profile dev_self_contained --non-interactive
```

This does a clean prebuild, runs the wizard, and builds for the `dev_self_contained` profile.


## Permissions
ask_before_editing: false
ask_before_running: false
