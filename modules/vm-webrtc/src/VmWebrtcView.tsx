import { requireNativeView } from 'expo';
import * as React from 'react';

import { VmWebrtcViewProps } from './VmWebrtc.types';

const NativeView: React.ComponentType<VmWebrtcViewProps> =
  requireNativeView('VmWebrtc');

export default function VmWebrtcView(props: VmWebrtcViewProps) {
  return <NativeView {...props} />;
}
