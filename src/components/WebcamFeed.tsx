import React, { useEffect } from 'react';

interface WebcamFeedProps {
  show: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  aspect?: 'wide' | 'tall' | 'square';
}

const WebcamFeed: React.FC<WebcamFeedProps> = ({ show, videoRef, aspect = 'tall' }) => {
  useEffect(() => {
    if (show && videoRef.current) {
      let width = 540, height = 960, aspectRatio = 9 / 16;
      if (aspect === 'wide') {
        width = 960; height = 540; aspectRatio = 16 / 9;
      } else if (aspect === 'square') {
        width = 720; height = 720; aspectRatio = 1;
      }
      navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          aspectRatio,
          facingMode: 'user',
        },
      })
        .then((stream) => {
          videoRef.current!.srcObject = stream;
          videoRef.current!.onloadedmetadata = () => {
            videoRef.current!.play();
          };
        })
        .catch(() => {
          alert('Webcam access denied or not available.');
        });
    } else if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
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
