/**
 * Одноразове «прогрівання» дозволу мікрофона для LEVADIUS.
 * getUserMedia → одразу stop tracks: індикатор гасне, дозвіл origin лишається.
 * Наступні SpeechRecognition / MediaRecorder у тій самій сесії зазвичай без діалогу.
 *
 * Після kill процесу iOS / очищення даних сайту ОС може спитати знову — це обмеження браузера.
 */

const STORAGE_KEY = "levadius.mic.granted";

let grantedMemory = false;

function readStoredGrant(): boolean {
  if (grantedMemory) return true;
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === "1") {
      grantedMemory = true;
      return true;
    }
  } catch {
    /* private mode */
  }
  return false;
}

function writeStoredGrant() {
  grantedMemory = true;
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export type MicPermissionResult = "granted" | "denied" | "unavailable";

export async function ensureLevadiusMicPermission(): Promise<MicPermissionResult> {
  if (typeof window === "undefined") return "unavailable";
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";

  if (readStoredGrant()) {
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        if (status.state === "denied") return "denied";
        if (status.state === "granted") return "granted";
        // "prompt" — все одно спробуємо getUserMedia нижче
      } else {
        return "granted";
      }
    } catch {
      return "granted";
    }
  }

  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (status.state === "granted") {
        writeStoredGrant();
        return "granted";
      }
      if (status.state === "denied") return "denied";
    }
  } catch {
    /* Safari часто без permissions.query для mic */
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    for (const track of stream.getTracks()) track.stop();
    writeStoredGrant();
    return "granted";
  } catch {
    return "denied";
  }
}
