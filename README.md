# Magnet to Google Drive Uploader

This Apify Actor downloads a magnet URL, zips the downloaded files, and uploads the ZIP to Google Drive.

## Files

- `package.json`
- `main.js`
- `INPUT_SCHEMA.json`

## Install

```bash
npm install
```

## Run locally

```bash
node main.js
```

## Example input

```json
{
  "magnetUrl": "magnet:?xt=urn:btih:YOUR_HASH&dn=example&tr=udp%3A%2F%2Ftracker.example.com%3A80%2Fannounce",
  "googleDrive": {
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "refreshToken": "YOUR_REFRESH_TOKEN",
    "folderId": "OPTIONAL_FOLDER_ID"
  }
}
```

## Notes

- Requires Google Drive OAuth credentials with the Drive API enabled.
- Requires a valid refresh token for Drive upload.
- The actor uploads a ZIP archive of the downloaded torrent contents.
