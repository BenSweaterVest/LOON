# LOON Passkey User Guide

WebAuthn/FIDO2 authentication guide

---

## What Are Passkeys?

Passkeys are a secure, convenient way to log in without remembering passwords. Instead of typing a password, you use your device's built-in security features like:

- **Face ID** (iPhones, iPads, Macs)
- **Touch ID** (iPhones, iPads, Macs)
- **Windows Hello** (Windows PCs)
- **Android Biometric** (Android phones)
- **Security Keys** (YubiKey, Google Titan, etc.)

Passkeys work across devices and browsers, and they're resistant to phishing attacks.

---

## Setting Up Your First Passkey

### Step 1: Log In with Password

1. Go to your LOON admin panel
2. Click "Login"
3. Enter your username and password
4. Click "Sign In"

### Step 2: Navigate to Security Settings

1. Click your username in the top-right corner
2. Select "Settings"
3. Click the "Security" tab
4. Find the "Passkeys" section

### Step 3: Add a Passkey

1. Click the "+ Add Passkey" button
2. Give your device a friendly name (e.g., "iPhone 15", "Work Laptop")
3. Click "Register Passkey"
4. Follow the browser prompts:
   - **Mac/iPhone**: Use Face ID or Touch ID
   - **Windows**: Use Windows Hello (face/fingerprint/PIN)
   - **Android**: Use fingerprint or face recognition
   - **Security Key**: Insert key and press the button

### Step 4: Save Recovery Codes

**IMPORTANT**: After registering your first passkey, you'll see 12 recovery codes.

**Save these codes in a secure location** (password manager, printed backup, etc.). You'll need them if:
- You lose your device
- Your passkey stops working
- You need to recover your account

**Do NOT share these codes with anyone.**

---

## Logging In with Passkey

### Option 1: Direct Passkey Login (Recommended)

1. Go to login page
2. Click "Login with Passkey" button
3. Choose your device when prompted (if you have multiple)
4. Authenticate with Face ID, Touch ID, or security key
5. You're logged in!

### Option 2: Passkey with Username Hint

1. Go to login page
2. Click "Login with Passkey"
3. If the browser asks, enter your username
4. Authenticate with Face ID, Touch ID, etc.
5. You're logged in!

### Option 3: Can't Use Passkey?

1. Go to login page
2. Click "Can't use passkey?"
3. Enter your username
4. Enter one of your recovery codes
5. You'll be logged in temporarily
6. Change your authentication method in Settings

---

## Managing Your Passkeys

### View All Passkeys

1. Go to Settings ? Security
2. You'll see a list of all registered passkeys with:
   - Device name (e.g., "iPhone 15")
   - Registration date
   - Last used date
   - Connection type (e.g., Built-in, USB)

### Rename a Passkey

1. Go to Settings ? Security ? Passkeys
2. Click the ?? (edit) icon next to a passkey
3. Enter a new device name
4. Click "Save"

### Delete a Passkey

1. Go to Settings ? Security ? Passkeys
2. Click the ??? (delete) icon next to a passkey
3. Confirm deletion
4. That device can no longer be used to log in

> **Tip**: Keep at least one passkey registered so you can always log in. If you delete all passkeys, you can still use your password.

---

## Recovery Codes

### Viewing Recovery Codes

1. Go to Settings ? Security
2. Click "Show Recovery Codes"
3. Read the warning about security
4. You'll see your unused codes

### Using a Recovery Code

1. Go to login page
2. Click "Can't use passkey?"
3. Enter your username
4. Enter one of your recovery codes (e.g., ABC12345)
5. You're authenticated temporarily
6. Once logged in, you can:
   - Register a new passkey
   - Disable passkeys and use password login
   - Regenerate new recovery codes

### Regenerating Recovery Codes

When you register a new passkey or use a recovery code:

1. New recovery codes are generated automatically
2. Old codes remain valid until used
3. Click "Show Recovery Codes" to see your current list
4. Numbers like "10 remaining" show unused codes

### Regenerating Codes Manually

1. Go to Settings ? Security
2. Click "Regenerate Recovery Codes"
3. Confirm (this will invalidate old codes)
4. New codes appear on screen
5. Save them in a secure location

---

## Troubleshooting

### "Can't use passkey right now"

**Problem**: Browser shows error during login

**Solutions**:
1. Make sure you have the latest browser version
2. Try a different browser (Chrome, Firefox, Safari, Edge all work)
3. Try a security key if you have one
4. Use recovery code method instead

### "Device not recognized"

**Problem**: Your device isn't in the allowed list

**Solutions**:
1. Make sure you registered that device (Settings ? Security ? Passkeys)
2. Try deleting and re-registering the passkey
3. Use a different device or recovery code

### "Lost my recovery codes"

**Problem**: Can't find your written/saved recovery codes

**Solutions**:
1. If you can still use a registered passkey: Log in ? Settings ? Regenerate Codes
2. If you lost all access: Contact your admin for emergency account recovery

### "Lost my device"

**Problem**: Your passkey device is broken or lost

**Solutions**:
1. Use a recovery code to log in
2. Once logged in, delete the lost device from Settings
3. Register a new passkey on a different device
4. Regenerate recovery codes

### "Browser says 'Your device doesn't support passkeys'"

**Problem**: Incompatible browser or OS

**Supported Browsers/Platforms**:
| Platform | Chrome | Firefox | Safari | Edge |
|----------|--------|---------|--------|------|
| Windows 10+ | Yes | Yes | N/A | Yes |
| Mac | Yes | Yes | Yes | Yes |
| iPhone/iPad | Yes | Yes | Yes | Yes |
| Android | Yes | Yes | N/A | Yes |

**Solutions**:
1. Update to latest browser version
2. Use a supported browser (Chrome/Firefox/Safari/Edge)
3. Try on a different device
4. Use password login as fallback

---

## Security Best Practices

### DO:

- **Save recovery codes** in a secure location (password manager, safe, etc.)
- **Register multiple passkeys** (phone + computer = backup)
- **Keep devices updated** (OS + browser security patches)
- **Delete unused devices** from Security settings
- **Review login history** (if available in your admin panel)

### DON'T:

- **Share recovery codes** with anyone
- **Write codes on sticky notes** left on your desk
- **Store codes in unsecured files** (like Notes app without password)
- **Log in on public Wi-Fi** without VPN
- **Use passkeys from public/borrowed devices** if possible

---

## Passkey vs. Password: FAQ

### Are passkeys safer than passwords?

**Yes**. Passkeys use cryptographic keys stored securely in your device. They can't be phished, guessed, or intercepted like passwords. Even if a website is hacked, your passkey stays secure on your device.

### Can I still use my password?

**Yes**. LOON supports both passwords and passkeys. You can:
- Continue using password login
- Add passkeys as backup
- Switch to passkey-only when ready

### What if I change devices?

**Easy**:
1. Log in on new device with password (or recovery code)
2. Go to Settings ? Security
3. Register a new passkey on the new device
4. Delete old device from list

### Can I share a passkey?

**No**. Passkeys are personal to your device. Each person needs their own account and passkey. This is a security feature.

### What if my recovery codes expire?

**They don't**. Recovery codes never expire. They remain valid until used. However, you can regenerate new codes anytime.

### Do I need internet to use passkey?

**During login**: Yes, you need internet to send the authentication to LOON.

**For biometric unlock**: No, your device unlocks with Face ID/Touch ID offline, then sends the cryptographic proof online.

---

## Getting Help

If you have issues:

1. **Technical support**: Contact your LOON administrator
2. **Browser issues**: Check browser console (F12) for errors
3. **Account recovery**: Use password login or recovery codes
4. **Security concerns**: Report to admin immediately

---

## Summary

| Task | Steps |
|------|-------|
| **Add passkey** | Settings ? Security ? Add Passkey ? Authenticate |
| **Log in** | "Login with Passkey" ? Authenticate |
| **Recover account** | "Can't use passkey?" ? Recovery code |
| **View codes** | Settings ? Security ? Show Recovery Codes |
| **Rename device** | Settings ? Security ? Click ?? |
| **Delete passkey** | Settings ? Security ? Click ??? |
| **Regenerate codes** | Settings ? Security ? Regenerate |

**Questions?** Contact your administrator or LOON support.
