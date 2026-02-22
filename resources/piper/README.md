# Piper Runtime Resources

Place platform binaries and optional models here for packaging.

- Binary paths expected by runtime:
  - `resources/piper/darwin-arm64/piper`
  - `resources/piper/darwin-x64/piper`
  - `resources/piper/win32-x64/piper.exe`
  - `resources/piper/win32-arm64/piper.exe`
  - `resources/piper/linux-x64/piper`
  - `resources/piper/linux-arm64/piper`

- Optional model bundle location:
  - `resources/piper/models/*.onnx`
  - `resources/piper/models/*.onnx.json`

Runtime command resolution order:
1. `settings.piperExecutablePath`
2. bundled resource binary under `resources/piper/<platform>/`
3. system `PATH` (`piper`)
