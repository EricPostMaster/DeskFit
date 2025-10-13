import React from 'react';

interface ProgressBarProps {
  value: number;
  max: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value, max }) => (
  <div style={{
    width: 320,
    height: 16,
    background: '#eee',
    borderRadius: 8,
    marginTop: 8,
    overflow: 'hidden',
    border: '1px solid #ccc'
  }}>
    <div style={{
      width: `${(value / max) * 100}%`,
      height: '100%',
      background: '#4caf50',
      transition: 'width 0.3s',
    }} />
  </div>
);

export default ProgressBar;
