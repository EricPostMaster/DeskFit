import React, { useEffect } from 'react';

interface WebcamFeedProps {
  show: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  aspect?: 'wide' | 'tall' | 'square';
}

const WebcamFeed: React.FC<WebcamFeedProps> = ({ show, videoRef, aspect = 'tall' }) => {
  const streamRef = React.useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;
    let startAttemptTimer: number | null = null;

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
          videoRef.current!.onloadedmetadata = () => { try { videoRef.current!.play(); } catch {} };
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
    <video
      ref={videoRef}
      autoPlay
      playsInline
      width={width}
      height={height}
      style={{ transform: 'scaleX(-1)' }}
    />
  );
};

export default WebcamFeed;
