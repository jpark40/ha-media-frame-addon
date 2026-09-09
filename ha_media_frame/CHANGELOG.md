# Changelog

## 1.2.5

- Publishes HA Media Frame as an installable Home Assistant add-on repository.
- Adds repository installation and update documentation.
- Adds the project URL to the add-on metadata.

## 1.2.4

- Makes forecast labels, precipitation, temperatures, and weather details at least as large as the current weekday/date text.
- Enlarges forecast condition icons and widens the desktop weather panel for the more readable forecast layout.
- Keeps the same forecast typography minimum on compact screens instead of shrinking below the weekday size.

## 1.2.3

- Corrects Fully Kiosk website playlist entries to `type: 0` with `loopItem: false`.
- Escapes URL slashes to match Fully Kiosk's generated Screensaver Playlist JSON format.

## 1.2.2

- Replaces bare Fully Kiosk URLs with ready-to-paste Screensaver Playlist JSON for Contain and Cover modes.
- Adds Fully Kiosk and video-file compatibility requirements to the settings page.
- Adds a copyable FFmpeg command for converting problematic videos to H.264 MP4 with no audio.
- Explicitly enables the HTML video autoplay attribute when playback begins.

## 1.2.1

- Shows complete, versioned Contain and Cover URLs in the Fully Kiosk settings section.
- Adds a separate Copy button for each fit-mode URL.

## 1.2.0

- Adds an adjustable video repeat count from 1 to 100 plays.
- Defaults to three total plays of each video before advancing to the preloaded next item.
- Applies the configured video-duration limit to each repeat; `0` plays every repeat to the end.
- Keeps every repeated play muted.

## 1.1.2

- Calculates the exact media rectangle from the file and screen aspect ratios so `Contain` cannot crop, even when Android WebView mishandles `object-fit`.
- Centers all media on a solid black stage, producing side or top/bottom bars as required.
- Supports `?fit=contain` or `?fit=cover` in the screen URL to override saved fit settings.
- Recalculates media dimensions after a screen resize or tablet orientation change.

## 1.1.1

- Fixes `Contain` mode so the complete photo or video is always visible with letterboxing instead of cropping.
- Applies fit changes to an already-open Fully Kiosk screen within a few seconds.
- Adds asset versioning to prevent an older Fully Kiosk WebView cache from retaining the previous fit CSS.

## 1.1.0

- Preloads and decodes the next photo while the current media is displayed.
- Prebuffers the next video in a hidden player with `preload=auto`.
- Keeps the current media visible if the next item needs more time, preventing a black frame or loading pause.

## 1.0.0

- Initial local Home Assistant app.
- Recursive photo and video playback from `/media`.
- HTTP range streaming for fast video seeking and startup.
- Live settings for photo time, video time, order, fit, fade, and rescans.
- Optional Home Assistant clock and weather overlays.
- Video is always forced muted.
