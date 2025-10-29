import * as React from 'react';

import { VmWebrtcViewProps } from './VmWebrtc.types';

export default function VmWebrtcView(props: VmWebrtcViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
