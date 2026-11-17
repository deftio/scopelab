# USB Endoscope viewer

Live viewer for a USB endoscope in the browser. It streams the camera, runs a
chain of classical image filters on every frame, draws live histograms and a
line profile, and captures stills and video. The whole UI is
[bitwrench](https://github.com/deftio/bitwrench) (TACO objects and BCCL
components). There is no build step.

```
npm install
npm start            # http://localhost:8090  (open in Chrome or Edge)
npm test             # filter unit tests
```

## How the data flows

```
endoscope (USB Video Class) -> getUserMedia -> <video>
  -> work canvas (mirror / rotate / digital zoom + pan / processing scale)
  -> RGBA frame -> filter chain (filters.js) -> view canvas (+ overlays)
  -> histogram, line profile, pixel probe, snapshots, MediaRecorder
```

### Why the video doesn't come over WebUSB

Nearly all USB endoscopes are standard UVC webcams. Chrome's WebUSB blocks
claiming USB Video Class interfaces, and macOS's own UVC driver owns them, so a
page cannot read raw frames over WebUSB. The video goes through the camera path
instead (`getUserMedia`). WebUSB is still used, in the **USB** tab:

- pair the endoscope and read its descriptors (vendor/product id, strings, USB
  version, every interface and alternate setting, endpoint packet sizes)
- **Use as camera** matches the USB vid:pid to the camera list and starts it
- USB connect and disconnect events show up as notifications

## Features

- **Camera**: pick the device (external cameras are preferred automatically and
  marked ★), resolution, frame rate. Hot-plug is supported: plugging the
  endoscope in switches to it. Shows the active stream's settings and any UVC
  hardware controls the camera exposes (exposure, focus, white balance, zoom,
  torch...).
- **Filters**, as an ordered chain. Each stage can be switched on or off,
  reordered, reset or removed, and shows how many ms it takes per frame.
  - Tone: brightness/contrast/gamma/saturation, grayscale, invert, auto levels,
    histogram equalisation (luma or RGB), CLAHE
  - Smooth: Gaussian, box, median 3×3/5×5, bilateral, unsharp mask
  - Edges: Sobel, Scharr, Prewitt (magnitude / x / y / direction as colour),
    Laplacian and LoG (absolute / signed / zero crossings), Canny (with an
    optional colour overlay), emboss
  - Segment: threshold (manual or Otsu), morphology (dilate, erode, open,
    close, gradient, top-hat), false colour (inferno, viridis, turbo, jet, bone)
  - Presets: Enhance, Denoise, Canny overlay, Sobel, LoG, Heat map
- **View**: mirror, flip, rotate, digital zoom with pan, processing resolution,
  split compare (side by side or wipe), overlays (crosshair, 10% grid, scope
  circle, timestamp).
- **Live analysis**: R/G/B/luma histogram (linear or log, raw or processed) with
  mean, std, median, min, max and the clipped percentage at 0 and 255. Line
  profile along a row or column; click the image to move the line. Pixel probe
  under the cursor.
- **Capture**: snapshots as PNG or JPEG (processed, raw, or as shown). Video
  recording of the view canvas (MP4 where Chrome supports it, otherwise WebM).
  Freeze frame: filters and zoom still apply to the frozen frame. Gallery with
  preview, download and delete. Captures are also saved to `./captures` by the
  local server.
- Keys: `Space` snapshot, `R` record, `F` freeze, `Enter` fullscreen.

## Files

| File | What it is |
|---|---|
| `server.js` | Zero-dependency static server. Serves bitwrench from `node_modules` and saves captures (`POST /api/save`) |
| `public/app.js` | The UI and frame loop |
| `public/filters.js` | Filters, histogram and stats as pure functions (browser + Node) |
| `test/filters.test.js` | `node --test` unit tests for the filters |

## Notes

- Filters run in JavaScript on the main thread. At 1280×720 a light chain runs
  at full rate. Heavy stages (bilateral, median 5×5, morphology, CLAHE + Canny)
  can take 50–150 ms per frame, and the Filters tab warns when that happens. Set
  **View → Processing resolution** to 50% or use 640×480 to get back to real time.
- Recordings capture the view canvas, so they include overlays and split view.
- `PORT=9000 npm start` changes the port. The server listens on 127.0.0.1 only.
