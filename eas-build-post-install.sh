#!/usr/bin/env bash

set -e

echo ""
echo "🔧 Running post-install hook: Patching WebRTC-lib headers..."
echo ""

# Define header directories relative to the project root
HEADER_DIRS=(
  "ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-arm64/WebRTC.framework/Headers"
  "ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-x86_64_arm64-simulator/WebRTC.framework/Headers"
)

patch_header_directory() {
  local relative_dir="$1"
  
  if [ ! -d "$relative_dir" ]; then
    echo "⚠️  Skipping $relative_dir: directory not found"
    return
  fi
  
  if [ ! -w "$relative_dir" ]; then
    echo "⚠️  Skipping $relative_dir: directory not writable"
    return
  fi
  
  local target_dir="$relative_dir/sdk/objc/base"
  mkdir -p "$target_dir"
  
  # Link all header files (excluding directories and the sdk directory itself)
  for file in "$relative_dir"/*; do
    local filename=$(basename "$file")
    
    # Skip the sdk directory
    if [ "$filename" = "sdk" ]; then
      continue
    fi
    
    # Skip directories
    if [ -d "$file" ]; then
      continue
    fi
    
    local destination="$target_dir/$filename"
    
    # Create hard link if it doesn't exist
    if [ ! -e "$destination" ]; then
      ln "$file" "$destination" 2>/dev/null || {
        echo "⚠️  Could not link $filename (may already exist or filesystem doesn't support hard links)"
      }
    fi
  done
  
  echo "✅ Patched headers in $relative_dir"
}

# Patch all header directories
for dir in "${HEADER_DIRS[@]}"; do
  patch_header_directory "$dir"
done

echo ""
echo "🎉 WebRTC header patching complete!"
echo ""
