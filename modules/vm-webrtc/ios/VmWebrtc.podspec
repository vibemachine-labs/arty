Pod::Spec.new do |s|
  s.name           = 'VmWebrtc'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'

  # Restrict to iOS; WebRTC-lib omits tvOS slices
  s.platforms      = { :ios => '15.1' }

  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Pinned to older version due to stasel/WebRTC/issues 132
  s.dependency 'WebRTC-lib', '140.0.0'
  s.dependency 'OpenTelemetry-Swift-Sdk', '~> 2.0'
  s.dependency 'OpenTelemetry-Swift-Protocol-Exporter-Common', '~> 2.0'
  s.dependency 'OpenTelemetry-Swift-Protocol-Exporter-Http', '~> 2.2'


  # Ensure Swift module visibility + access to WebRTC headers
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => %w[
      $(inherited)
      $(PODS_ROOT)/WebRTC-lib/WebRTC.framework/Headers
      $(PODS_ROOT)/WebRTC-lib/WebRTC.xcframework/ios-arm64/WebRTC.framework/Headers
      $(PODS_ROOT)/WebRTC-lib/WebRTC.xcframework/ios-x86_64_arm64-simulator/WebRTC.framework/Headers
    ].join(' '),
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES',
  }

  s.source_files = '**/*.swift'
end
