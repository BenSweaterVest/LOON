/**
 * Loads the vendored SimpleWebAuthn browser bundle on first use.
 */

let loading = null;

function load() {
    if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
    if (!loading) {
        loading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/admin/vendor/simplewebauthn-browser.js';
            script.onload = () => resolve(window.SimpleWebAuthnBrowser);
            script.onerror = () => {
                loading = null;
                reject(new Error('Could not load passkey support'));
            };
            document.head.append(script);
        });
    }
    return loading;
}

export function passkeysSupported() {
    return typeof window.PublicKeyCredential === 'function';
}

export async function createPasskey(optionsJSON) {
    const lib = await load();
    return lib.startRegistration({ optionsJSON });
}

export async function usePasskey(optionsJSON) {
    const lib = await load();
    return lib.startAuthentication({ optionsJSON });
}

/** Turn browser WebAuthn errors into something a person can act on. */
export function passkeyErrorMessage(err) {
    if (err?.name === 'NotAllowedError') return 'Passkey request was cancelled or timed out.';
    if (err?.name === 'InvalidStateError') return 'This device already has a passkey for this account.';
    if (err?.name === 'SecurityError') return 'Passkeys need HTTPS and a matching domain (RP_ID).';
    return err?.message || 'Passkey failed.';
}
