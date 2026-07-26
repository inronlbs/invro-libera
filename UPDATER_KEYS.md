# Invro Libera - Auto-Updater Minisign Signature Keys

This document contains the Minisign keypair and signature configuration details used by `@tauri-apps/plugin-updater` for signing and verifying desktop application updates.

---

## 🔑 Public Key
**Configured in `src-tauri/tauri.conf.json` under `"plugins.updater.pubkey"`:**

```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg4NkQ3NDRCNTVBRDk5MTUKUldRVm1hMVZTM1J0aUFHSzJFd2ZFaUhNaWFhS0x3WHNGM0NLMnFhVCs1WWVSQ205dXgrYkpDem4K
```

---

## 🔐 Private Key
**Stored locally at `tauri-key.key` (Password: None / empty):**

```
dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5S1E0YzdaVnNyWllUL0ZJVWMxS0QxcC9ETjVWUGRxR29tY3J1L3diTzU0b0FBQkFBQUFBQUFBQUFBQUlBQUFBQXE4dHhBSTVLSnhWR2JwVU1PbnhDRVpCUFNmRTQrSXlCRWIrUlZucHVyZWZURk00ZGd0cndoUHN4OVJUZ0VRekJzRHFObHBTUExXeU5UQXVwazJDbW9IZDNHbjgyM1dqVzB0TFJMSHVQQTVLZVRPMmtkTHZuRjZaSWgrR1R0N0JQdW1wQnpXTFhtMVE9Cg==
```

---

## 📦 How to Sign New Releases

When building a new version of Invro Libera Standalone for auto-update:

1. **Build the NSIS Setup Executable**:
   ```bash
   npx tauri build -b nsis --ignore-version-mismatches
   ```

2. **Sign the Output Installer**:
   ```bash
   npx tauri signer sign -f tauri-key.key "src-tauri/target/release/bundle/nsis/Invro Libera Standalone_<VERSION>_x64-setup.exe" --password ""
   ```

3. **Update `latest.json`**:
   - Set `"version": "<VERSION>"` (pure SemVer `X.Y.Z` format, e.g. `1.5.0`)
   - Paste the generated signature string into `"signature"`
   - Set `"url"` to the GitHub Releases setup executable download link

4. **Publish GitHub Release & Commit**:
   ```bash
   gh release create v<VERSION>-standalone "src-tauri/target/release/bundle/nsis/Invro Libera Standalone_<VERSION>_x64-setup.exe#Invro.Libera.Standalone_<VERSION>_x64-setup.exe" "latest.json#latest.json" --title "Invro Libera Standalone v<VERSION>" --notes "Release notes here..."
   git add . && git commit -m "bump: release v<VERSION>" && git push origin master
   ```

---

## 📝 Recent Signatures Log

| Release Version | Target Setup Executable | Minisign Signature |
|---|---|---|
| **v1.5.0** | `Invro.Libera.Standalone_1.5.0_x64-setup.exe` | `dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRVm1hMVZTM1J0aUp0MExUSC9SaU42cnllM1FnRGZ1VTh3cE9mRGJKc1VTdEhBMnlXN2FBa0lQQXBibWlFZzRxOVFxZlkyZDBseHVCUmcyaG4yWmZYUStVcVpKZ0xrdWdZPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg1MDI1NTM4CWZpbGU6SW52cm8gTGliZXJhIFN0YW5kYWxvbmVfMS41LjBfeDY0LXNldHVwLmV4ZQp4V3I2SEE4RmlSRzZiZDVxZ2NabGs2SEhDcThCZ0xBb3ZzeStObllLS0ZwdzdsaFk4S09ZMkt1TXFocm15c0RoWnZhRTBXYXVCSXh0NE9yd2wrQXJCQT09Cg==` |
| **v1.4.1** | `Invro.Libera.Standalone_1.4.1_x64-setup.exe` | `dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRVm1hMVZTM1J0aURIODJ6cWQxdjNOcFBSSjZueDdPOXN0MDRyTFRteURaN1FKbU04d3Z1UXU1U3lvVTVhNWg2RUVFa1FzdytYMFhwdUVUZExnbW9nZXlFMUU3bGpqTlFNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg1MDI1MDM3CWZpbGU6SW52cm8gTGliZXJhIFN0YW5kYWxvbmVfMS40LjFfeDY0LXNldHVwLmV4ZQpNVUtDZXB6Vy90NXhjWlRPc054MVdveUdoZ0d1eUZibjRLKzZVeE9nc2NhdDZDUDk4RThoQzUyYTlndm54VjFtOUtENkN1aVV2cmt3OE96WmhBN1JEQT09Cg==` |
