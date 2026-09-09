# HA Media Frame

A local, DAKboard-style full-screen photo and video player for Home Assistant OS. It reads an Unraid SMB share through Home Assistant's built-in network storage mount and exposes a direct LAN URL for Fully Kiosk Browser.

## What it does

- Recursively plays JPG, JPEG, PNG, GIF, WebP, BMP, AVIF, MP4, M4V, MOV, WebM, and OGV files.
- Preloads and decodes the next photo or prebuffers the next video while the current item is still playing.
- Forces every video to stay muted, including after a page resume.
- Uses byte-range streaming so videos do not have to download completely before playback.
- Offers separate photo and video durations. Set video duration to `0` to play each repeat to the end.
- Repeats each video three times by default, with an adjustable total play count from 1 to 100.
- Supports shuffle or alphabetical order, `contain` or `cover`, fade duration, and automatic rescanning.
- Applies display-setting changes to an already-open screen within a few seconds.
- Shows a DAKboard-like clock/date and optional weather data from a Home Assistant `weather.*` entity.
- Stores settings in the app's persistent `/data` directory. Media is mounted read-only.

## 1. Mount the Unraid SMB share in Home Assistant

1. In Unraid, make the photo/video folder an SMB share and create a read-only SMB user for Home Assistant.
2. In Home Assistant, open **Settings → System → Storage**.
3. Select **Add network storage**.
4. Use:
   - **Name:** for example `UnraidMedia`
   - **Usage:** `Media`
   - **Server:** your Unraid IP address
   - **Protocol:** `CIFS`
   - **Share:** the Unraid SMB share name
   - **Username / Password:** the read-only Unraid account
5. Select **Connect**. The share becomes `/media/UnraidMedia` inside Home Assistant and apps.

## 2. Install the add-on repository

1. In Home Assistant, open **Settings → Apps → Install app**.
2. Open the menu in the upper-right and choose **Repositories**.
3. Add `https://github.com/jpark40/ha-media-frame-addon`.
4. Close the repository dialog and refresh the app store.
5. Open **HA Media Frame**, select **Install**, then **Start**.
6. Enable **Start on boot** and **Watchdog**.

The first installation builds the container locally and can take several minutes. No Home Assistant restart is required.

## 3. Configure the frame

Open the app's **Open Web UI** button, or browse to:

`http://HOME_ASSISTANT_IP:8099/settings`

Choose `/media/UnraidMedia` (or a folder below it), select the weather entity, set the photo/video timing, and save. Use **Open screen** to verify playback.

## 4. Use it in Fully Kiosk

Open this app's settings page and copy the complete **Contain** or **Cover** playlist JSON. Paste it into **Fully Kiosk → Screensaver → Screensaver Playlist (JSON)**. The JSON adds this app as a `type: 0` website item; the app manages all photo/video switching itself.

Use the numeric Home Assistant LAN IP instead of `homeassistant.local` for the most reliable wake-up behavior. In Fully Kiosk, enable **Autoplay** and JavaScript, and disable **Fullscreen Videos** so HTML5 videos stay inside the frame page. The page itself permanently mutes every video.

## Timing behavior

- **Photo duration:** how long each photo stays visible.
- **Video duration:** maximum time for each play. `0` means play the complete video.
- **Video repeats:** total number of plays before advancing. The default is `3`.
- If a clip ends before the fixed duration, the next repeat begins immediately.
- If a video cannot play in Android WebView, the player skips it automatically.

## Video compatibility

The app does not transcode. File extensions are discovered broadly, but the codec must be supported by Android System WebView. The safest target is an MP4 container with H.264 AVC Baseline or Main video, 8-bit YUV 4:2:0, 1080p/30 fps or lower, fast-start metadata, and no audio track. HEVC/H.265, 10-bit HDR, Dolby Vision, some iPhone MOV files, AV1, and unusual WebM/OGV encodings may fail depending on the tablet and WebView version.

Compatibility conversion:

`ffmpeg -i input.mov -map 0:v:0 -vf "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p" -r 30 -c:v libx264 -profile:v main -level:v 4.1 -tag:v avc1 -crf 22 -preset medium -maxrate 8M -bufsize 16M -movflags +faststart -an output.mp4`

## Useful URLs

- Screen (Contain): `http://HOME_ASSISTANT_IP:8099/?fit=contain&v=1.2.5`
- Screen (Cover): `http://HOME_ASSISTANT_IP:8099/?fit=cover&v=1.2.5`
- Settings: `http://HOME_ASSISTANT_IP:8099/settings`
- Health check: `http://HOME_ASSISTANT_IP:8099/health`

## Troubleshooting

- **Folder is missing:** confirm the network storage Usage is `Media`, then restart this app.
- **No files found:** select the exact `/media/<storage-name>` path and press **Rescan now**.
- **A video is skipped:** convert it to H.264 MP4 and try again.
- **Screen is unreachable:** verify the app is running and that port `8099` is enabled in its Network settings.
- **Weather is blank:** select a valid `weather.*` entity. Media playback continues even if Home Assistant weather is unavailable.
- **Contain still looks cropped after upgrading:** confirm `/health` reports the current app version, then use `/?fit=contain` in Fully Kiosk and force-reload the screensaver once.
