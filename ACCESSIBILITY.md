# Accessibility Statement

GeoWake is committed to making its web application usable by as many people
as possible.

## Supported Environments

- Modern evergreen browsers (Chrome, Firefox, Safari, Edge) on desktop and
  mobile.
- HTTPS required in production (geolocation and service workers depend on it).
- Screen readers: basic ARIA labels on interactive controls.

## Known Limitations

- Web only: no native iOS/Android build in this release.
- Audio requires a user gesture before playback (browser policy).
- Geolocation requires HTTPS (localhost excepted).
- Map interaction is pointer-based; keyboard navigation is partial.
- Vibration (`navigator.vibrate`) is supported only on some browsers/devices.

## How to Report Barriers

If you encounter an accessibility barrier, please email
**daiwickramesh1999@gmail.com** or open an issue using the Bug report template,
tagging it `accessibility`. Include your browser, device, assistive technology,
and steps to reproduce.