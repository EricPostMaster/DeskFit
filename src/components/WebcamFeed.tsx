import React, { useEffect } from 'react';

interface WebcamFeedProps {
  show: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  aspect?: 'wide' | 'tall' | 'square';
  // Optional callback to notify parent about the intrinsic (videoWidth/videoHeight) dimensions
  // once available. Useful so other hooks (like pose detection) can prefer the largest observed size.
  onMaxVideoSizeChange?: (size: { width: number; height: number }) => void;
  overlayRef?: React.RefObject<HTMLCanvasElement | null>;
  showOverlay?: boolean;
}

const WebcamFeed: React.FC<WebcamFeedProps> = ({ show, videoRef, aspect = 'tall', onMaxVideoSizeChange, overlayRef, showOverlay = true }) => {
  const streamRef = React.useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;
    let startAttemptTimer: number | null = null;
    let currentMax = { width: 0, height: 0 };

    const stopStream = () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
          streamRef.current = null;
        }
        if (videoRef.current && videoRef.current.srcObject) {
          try {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => { try { t.stop(); } catch {} });
          } catch {}
          try { videoRef.current.srcObject = null; } catch {}
        }
      } catch (e) {}
    };

    const tryStart = async () => {
      if (!mounted) return;
      if (!show) return;
      if (!videoRef.current) {
        // retry shortly until the video element is mounted
        startAttemptTimer = window.setTimeout(tryStart, 150) as unknown as number;
        return;
      }
      let width = 540, height = 960, aspectRatio = 9 / 16;
      if (aspect === 'wide') {
        width = 960; height = 540; aspectRatio = 16 / 9;
      } else if (aspect === 'square') {
        width = 720; height = 720; aspectRatio = 1;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: width }, height: { ideal: height }, aspectRatio, facingMode: 'user' }
        });
        if (!mounted) {
          // stop immediately if unmounted
          stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
          return;
        }
        streamRef.current = stream;
        try {
          videoRef.current!.srcObject = stream;
          videoRef.current!.onloadedmetadata = () => {
            try { videoRef.current!.play(); } catch {}
            // capture intrinsic video dimensions and persist the max seen
            try {
              const vw = videoRef.current!.videoWidth || videoRef.current!.width || 0;
              const vh = videoRef.current!.videoHeight || videoRef.current!.height || 0;
              if (vw > currentMax.width || vh > currentMax.height) {
                currentMax = { width: Math.max(currentMax.width, vw), height: Math.max(currentMax.height, vh) };
                // Apply the max display size to the element so downstream consumers see the larger area
                try {
                  videoRef.current!.width = currentMax.width;
                  videoRef.current!.height = currentMax.height;
                } catch {}
                if (typeof onMaxVideoSizeChange === 'function') {
                  try { onMaxVideoSizeChange(currentMax); } catch {}
                }
              }
            } catch {}
          };
        } catch (e) {
          // fallback if assigning srcObject fails
        }
      } catch (err) {
        // silent
        console.warn('getUserMedia failed', err);
      }
    };

    if (show) tryStart(); else stopStream();

    return () => {
      mounted = false;
      if (startAttemptTimer) clearTimeout(startAttemptTimer as number);
      stopStream();
    };
  }, [show, videoRef, aspect]);

  let width = 320, height = 240;
  if (aspect === 'wide') {
    width = 400; height = 225;
  } else if (aspect === 'square') {
    width = 320; height = 320;
  } else if (aspect === 'tall') {
    width = 240; height = 320;
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', width, height }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        width={width}
        height={height}
        style={{ transform: 'scaleX(-1)', display: 'block', width: '100%', height: '100%' }}
      />
      {showOverlay ? (
        <canvas
          ref={overlayRef}
          // Let the hook set the internal pixel size to the video's intrinsic
          // resolution while keeping the displayed CSS size matched to the wrapper.
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', transform: 'scaleX(-1)', width: '100%', height: '100%' }}
        />
      ) : null}
    </div>
  );
};

export default WebcamFeed;
