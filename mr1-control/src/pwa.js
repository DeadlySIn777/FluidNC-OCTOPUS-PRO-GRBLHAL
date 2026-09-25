export function initializePwa(options = {}) {
  const windowLike = options.window ?? globalThis.window;
  const navigatorLike = options.navigator ?? globalThis.navigator;
  const installButton = options.installButton ?? null;
  let installPrompt = null;

  const hideInstallButton = () => {
    if (installButton) installButton.hidden = true;
  };
  const showInstallButton = () => {
    if (installButton) installButton.hidden = false;
  };
  const onBeforeInstallPrompt = (event) => {
    event.preventDefault?.();
    installPrompt = event;
    showInstallButton();
  };
  const onAppInstalled = () => {
    installPrompt = null;
    hideInstallButton();
  };
  const onInstallClick = async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    hideInstallButton();
    try {
      await prompt.prompt?.();
      await prompt.userChoice;
    } catch {
      // The browser owns install availability; a rejected prompt is non-fatal.
    }
  };

  hideInstallButton();
  windowLike?.addEventListener?.("beforeinstallprompt", onBeforeInstallPrompt);
  windowLike?.addEventListener?.("appinstalled", onAppInstalled);
  installButton?.addEventListener?.("click", onInstallClick);

  let registration = null;
  const register = async () => {
    if (options.enabled === false || !windowLike?.isSecureContext || !navigatorLike?.serviceWorker) return null;
    try {
      registration = await navigatorLike.serviceWorker.register("/sw.js", { scope: "/" });
      return registration;
    } catch {
      return null;
    }
  };

  return {
    register,
    dispose() {
      windowLike?.removeEventListener?.("beforeinstallprompt", onBeforeInstallPrompt);
      windowLike?.removeEventListener?.("appinstalled", onAppInstalled);
      installButton?.removeEventListener?.("click", onInstallClick);
    },
    get registration() {
      return registration;
    },
  };
}
