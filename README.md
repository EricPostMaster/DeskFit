# DeskFit: Physical Fitness App for Desk Workers

## Overview
DeskFit is an application designed to help knowledge workers who spend most of their day at a desk stay physically active. The app uses the user's webcam to track and count exercise movements, prompting users to perform short exercises at regular intervals.

DeskFit is a React + Vite + TypeScript application. The app uses TensorFlow.js for pose estimation, includes a timer, webcam integration, and a simple UI for exercise prompts and rep counting. In the MVP, all processing is local for simplicity and maximum privacy.

## What the App Does
- Allows users to set a timer for exercise breaks.
- When the timer goes off, the app pops up and instructs the user to perform a specific exercise (e.g., arm raises).
- Uses the webcam and pose estimation to track and count exercise repetitions.
- Once the user completes the required reps, the timer resets for the next break.

## MVP (Minimum Viable Product) Features
- **User Timer**: User can set a custom interval for exercise reminders.
- **Exercise Prompt**: When the timer ends, the app displays a prompt with the exercise and required reps.
- **Webcam Integration**: Accesses the user's webcam (with permission) for exercise tracking.
- **Pose Estimation**: Uses TensorFlow.js (e.g., MoveNet or PoseNet) to detect and count reps for a single exercise (e.g., arm raises). Optional pose keypoint overlays to help users see thresholds required to complete exercises (e.g. how high to lift arms).
- **Rep Counter**: Displays the current rep count and notifies the user when the set is complete.
- **Local Processing**: All webcam and pose data is processed locally for privacy.
- **Daily Goals**: Daily goals and exercise task count completion.
- **Simple UI**: Clean, minimal interface for timer, exercise prompt, webcam feed, and rep counter.

## Out of Scope for MVP
- Multiple exercises or routines
- Gamification or analytics
- Social or sharing features
- Integration with external devices or calendars

## Enhancements Scope
See `README_ENHANCEMENTS.md` for enhancements under consideration.
